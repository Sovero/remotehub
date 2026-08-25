// rdp-com-host.cpp
// MsTscAx ActiveX COM control — чистая замена mstsc.exe.
// Загружает RDP ActiveX (MsTscAx.MsTscAx) в скрытое окно, подключается
// к RDP-серверу, выводит HWND в stdout для SetParent из Electron.
//
// Сборка (x64 Native Tools):
//   cl /std:c++17 /EHsc /O2 /D_UNICODE /DUNICODE rdp-com-host.cpp ^
//      /link user32.lib ole32.lib oleaut32.lib shell32.lib /out:rdp-com-host.exe
//
// Запуск:
//   rdp-com-host.exe <host> <port> <username> <password> [domain] [width] [height]
//   → stdout: "HWND:1A2B3C4D"
//   → stdin:  "quit" / "resize W H"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <ocidl.h>
#include <oaidl.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <atomic>
#include <iostream>

// CLSID MsTscAx.MsTscAx.10 — {8B918B82-7985-4C24-89DF-C33AD2BBFBCD}
static const CLSID CLSID_MsRdpClient =
    {0x8B918B82, 0x7985, 0x4C24, {0x89, 0xDF, 0xC3, 0x3A, 0xD2, 0xBB, 0xFB, 0xCD}};

HWND g_hwndParent  = nullptr;
HWND g_hwndRdp     = nullptr;
std::atomic<bool> g_running(true);

// --- VARIANT helpers ---
VARIANT VarBstr(const wchar_t* s) {
    VARIANT v; VariantInit(&v);
    v.vt = VT_BSTR;
    v.bstrVal = SysAllocString(s);
    return v;
}
VARIANT VarLong(long n) {
    VARIANT v; VariantInit(&v);
    v.vt = VT_I4;
    v.lVal = n;
    return v;
}
void ClearVar(VARIANT& v) { VariantClear(&v); }

// --- DISPID lookup по имени (правильный COM-подход вместо хардкода) ---
DISPID GetDispId(IDispatch* d, const wchar_t* name) {
    DISPID id = DISPID_UNKNOWN;
    LPOLESTR names[1] = { (LPOLESTR)name };
    HRESULT hr = d->GetIDsOfNames(IID_NULL, names, 1, LOCALE_USER_DEFAULT, &id);
    if (FAILED(hr)) return DISPID_UNKNOWN;
    return id;
}

HRESULT PutProp(IDispatch* d, DISPID id, VARIANT& v) {
    DISPID dispidPut = DISPID_PROPERTYPUT;
    DISPPARAMS dp = { &v, &dispidPut, 1, 1 };
    return d->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT,
                     DISPATCH_PROPERTYPUT, &dp, nullptr, nullptr, nullptr);
}
HRESULT PutPropByName(IDispatch* d, const wchar_t* name, VARIANT& v) {
    DISPID id = GetDispId(d, name);
    if (id == DISPID_UNKNOWN) return E_FAIL;
    return PutProp(d, id, v);
}

IDispatch* GetPropDisp(IDispatch* d, DISPID id) {
    VARIANT v; VariantInit(&v);
    DISPPARAMS dp = { nullptr, nullptr, 0, 0 };
    HRESULT hr = d->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT,
                           DISPATCH_PROPERTYGET, &dp, &v, nullptr, nullptr);
    if (FAILED(hr) || v.vt != VT_DISPATCH || !v.pdispVal) {
        ClearVar(v);
        return nullptr;
    }
    return v.pdispVal;
}
IDispatch* GetPropDispByName(IDispatch* d, const wchar_t* name) {
    DISPID id = GetDispId(d, name);
    if (id == DISPID_UNKNOWN) return nullptr;
    return GetPropDisp(d, id);
}

HRESULT CallMethod(IDispatch* d, DISPID id) {
    DISPPARAMS dp = { nullptr, nullptr, 0, 0 };
    return d->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT,
                     DISPATCH_METHOD, &dp, nullptr, nullptr, nullptr);
}
HRESULT CallMethodByName(IDispatch* d, const wchar_t* name) {
    DISPID id = GetDispId(d, name);
    if (id == DISPID_UNKNOWN) return E_FAIL;
    return CallMethod(d, id);
}

// --- Window ---
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_CLOSE) {
        g_running = false;
        PostQuitMessage(0);
        return 0;
    }
    if (msg == WM_SIZE && g_hwndRdp) {
        RECT rc;
        GetClientRect(hwnd, &rc);
        SetWindowPos(g_hwndRdp, nullptr, 0, 0, rc.right, rc.bottom,
                    SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

// --- stdin thread ---
void StdinThread() {
    std::string line;
    while (g_running && std::getline(std::cin, line)) {
        if (line == "quit") {
            g_running = false;
            PostMessage(g_hwndParent, WM_CLOSE, 0, 0);
            break;
        }
        if (line.rfind("resize ", 0) == 0) {
            int w = 0, h = 0;
            if (sscanf_s(line.c_str(), "resize %d %d", &w, &h) == 2 && w > 0 && h > 0) {
                SetWindowPos(g_hwndParent, nullptr, 0, 0, w, h,
                            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
            }
        }
    }
}

// --- main (console subsystem) ---
int main() {
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (argc < 5) {
        std::cerr << "Usage: rdp-com-host <host> <port> <user> <pass> [domain] [w] [h]"
                  << std::endl;
        return 1;
    }
    std::wstring host     = argv[1];
    int port              = _wtoi(argv[2]);
    std::wstring username = argv[3];
    std::wstring password = argv[4];
    std::wstring domain   = (argc > 5 && argv[5][0] != L'\0') ? argv[5] : L"";
    int width             = (argc > 6) ? _wtoi(argv[6]) : 1024;
    int height            = (argc > 7) ? _wtoi(argv[7]) : 768;
    LocalFree(argv);
    if (width < 100)  width  = 100;
    if (height < 100) height = 100;

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        std::cerr << "CoInit: 0x" << std::hex << hr << std::endl;
        return 2;
    }

    const wchar_t WC[] = L"RdpComHostWnd";
    WNDCLASSW wc = {};
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = GetModuleHandleW(nullptr);
    wc.lpszClassName = WC;
    wc.hCursor       = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);

    g_hwndParent = CreateWindowExW(
        0, WC, L"RdpComHost",
        WS_OVERLAPPEDWINDOW,
        0, 0, width, height,
        nullptr, nullptr, GetModuleHandleW(nullptr), nullptr
    );
    if (!g_hwndParent) {
        std::cerr << "CreateWindow: " << GetLastError() << std::endl;
        CoUninitialize();
        return 3;
    }

    IUnknown* pRdp = nullptr;
    hr = CoCreateInstance(CLSID_MsRdpClient, nullptr, CLSCTX_INPROC_SERVER,
                          IID_IUnknown, (void**)&pRdp);
    if (FAILED(hr) || !pRdp) {
        std::cerr << "MsTscAx: 0x" << std::hex << hr << std::endl;
        DestroyWindow(g_hwndParent);
        CoUninitialize();
        return 4;
    }

    IOleObject* pOle = nullptr;
    hr = pRdp->QueryInterface(IID_IOleObject, (void**)&pOle);
    if (SUCCEEDED(hr) && pOle) {
        RECT rc;
        GetClientRect(g_hwndParent, &rc);
        pOle->DoVerb(OLEIVERB_INPLACEACTIVATE, nullptr, nullptr, 0,
                     g_hwndParent, &rc);
        pOle->Release();
    }

    IOleInPlaceObject* pInPlace = nullptr;
    hr = pRdp->QueryInterface(IID_IOleInPlaceObject, (void**)&pInPlace);
    if (SUCCEEDED(hr) && pInPlace) {
        pInPlace->GetWindow(&g_hwndRdp);
        pInPlace->Release();
    }
    if (!g_hwndRdp || !IsWindow(g_hwndRdp)) {
        g_hwndRdp = GetWindow(g_hwndParent, GW_CHILD);
    }

    IDispatch* pDisp = nullptr;
    hr = pRdp->QueryInterface(IID_IDispatch, (void**)&pDisp);
    if (!pDisp) {
        std::cerr << "IDispatch: 0x" << std::hex << hr << std::endl;
        pRdp->Release();
        DestroyWindow(g_hwndParent);
        CoUninitialize();
        return 5;
    }

    // Server, UserName — по имени (через GetIDsOfNames)
    { VARIANT v = VarBstr(host.c_str());     PutPropByName(pDisp, L"Server", v);   ClearVar(v); }
    { VARIANT v = VarBstr(username.c_str()); PutPropByName(pDisp, L"UserName", v);  ClearVar(v); }
    if (!domain.empty()) {
        VARIANT v = VarBstr(domain.c_str()); PutPropByName(pDisp, L"Domain", v);   ClearVar(v);
    }

    // DesktopWidth / DesktopHeight
    { VARIANT v = VarLong(width);  PutPropByName(pDisp, L"DesktopWidth", v);  ClearVar(v); }
    { VARIANT v = VarLong(height); PutPropByName(pDisp, L"DesktopHeight", v); ClearVar(v); }

    // SecuredSettings2 (более новый интерфейс) — пароль
    IDispatch* pSec = GetPropDispByName(pDisp, L"SecuredSettings2");
    if (!pSec) pSec = GetPropDispByName(pDisp, L"SecuredSettings");
    if (pSec) {
        VARIANT vp = VarBstr(password.c_str());
        HRESULT hrPw = PutPropByName(pSec, L"ClearTextPassword", vp);
        ClearVar(vp);
        if (FAILED(hrPw)) {
            std::cerr << "SetPassword: 0x" << std::hex << hrPw << std::endl;
        }
        pSec->Release();
    } else {
        std::cerr << "SecuredSettings not found" << std::endl;
    }

    // AdvancedSettings — порт + CredSSP
    IDispatch* pAdv = GetPropDispByName(pDisp, L"AdvancedSettings");
    if (pAdv) {
        { VARIANT v = VarLong(port); PutPropByName(pAdv, L"RDPPort", v); ClearVar(v); }
        // EnableCredSspSupport — может не быть в старых версиях, игнорируем ошибку
        { VARIANT v = VarLong(1); PutPropByName(pAdv, L"EnableCredSspSupport", v); ClearVar(v); }
        pAdv->Release();
    }

    // Передаём наружу окно-контейнер, а не дочерний ActiveX HWND. Оставив
    // контрол дочерним, сохраняем его OLE-родителя: он продолжает получать
    // WM_SIZE, сообщения и отрисовку после SetParent в окне Electron.
    uintptr_t hwndOut = (uintptr_t)g_hwndParent;
    std::cout << "HWND:" << std::hex << hwndOut << std::endl;
    std::cout.flush();

    // Connect — по имени метода
    hr = CallMethodByName(pDisp, L"Connect");
    if (FAILED(hr)) {
        std::cerr << "Connect: 0x" << std::hex << hr << std::endl;
    }

    // stdin поток
    std::thread t(StdinThread);
    t.detach();

    // Message loop
    MSG msg = {};
    while (g_running && GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    // Cleanup
    CallMethodByName(pDisp, L"Disconnect");
    pDisp->Release();
    pRdp->Release();
    DestroyWindow(g_hwndParent);
    CoUninitialize();
    return 0;
}

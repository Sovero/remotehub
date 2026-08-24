// rdp-com-host.cpp
// MsRdpClient9 ActiveX COM control — чистая замена mstsc.exe.
// Загружает RDP ActiveX в скрытое окно, подключается к серверу,
// выводит HWND в stdout для SetParent из Electron.
//
// Сборка (x64 Native Tools):
//   cl /std:c++17 /EHsc /O2 /D_UNICODE /DUNICODE rdp-com-host.cpp ^
//      /link user32.lib ole32.lib oleaut32.lib /out:rdp-com-host.exe
//
// Запуск:
//   rdp-com-host.exe <host> <port> <username> <password> [domain] [width] [height]
//   → stdout: "HWND:1A2B3C4D"
//   → stdin:  "quit" / "resize W H"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>   // CommandLineToArgvW
#include <ocidl.h>
#include <oaidl.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <atomic>
#include <iostream>

// CLSID MsRdpClient9NotSafeForScripting
static const CLSID CLSID_MsRdpClient9 =
    {0x301B94BA, 0x5D25, 0x4A12, {0xBF, 0xFE, 0x3B, 0x6B, 0x7A, 0x61, 0x65, 0x85}};

// DISPID для IMsRdpClientAdvancedSettings / IMsTscAx
enum RdpDispId {
    DISPID_SERVER        = 1,
    DISPID_DOMAIN        = 2,
    DISPID_USERNAME      = 3,
    DISPID_CONNECT       = 4,
    DISPID_DISCONNECT    = 5,
    DISPID_DESKTOPWIDTH  = 12,
    DISPID_DESKTOPHEIGHT = 13,
    DISPID_SECURED       = 0xFB,   // IMsRdpClientSecuredSettings
    DISPID_ADVANCED      = 0xFA,   // IMsRdpClientAdvancedSettings2
};

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

HRESULT PutProp(IDispatch* d, DISPID id, VARIANT& v) {
    DISPID dispidPut = DISPID_PROPERTYPUT;
    DISPPARAMS dp = { &v, &dispidPut, 1, 1 };
    return d->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT,
                     DISPATCH_PROPERTYPUT, &dp, nullptr, nullptr, nullptr);
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

HRESULT CallMethod(IDispatch* d, DISPID id) {
    DISPPARAMS dp = { nullptr, nullptr, 0, 0 };
    return d->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT,
                     DISPATCH_METHOD, &dp, nullptr, nullptr, nullptr);
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

    // COM init (STA — ActiveX требует STA)
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        std::cerr << "CoInit: 0x" << std::hex << hr << std::endl;
        return 2;
    }

    // Window class
    const wchar_t WC[] = L"RdpComHostWnd";
    WNDCLASSW wc = {};
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = GetModuleHandleW(nullptr);
    wc.lpszClassName = WC;
    wc.hCursor       = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);

    // Создаём СКРЫТОЕ окно — Electron сделает SetParent и покажет его
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

    // Создаём MsRdpClient9 ActiveX
    IUnknown* pRdp = nullptr;
    hr = CoCreateInstance(CLSID_MsRdpClient9, nullptr, CLSCTX_INPROC_SERVER,
                          IID_IUnknown, (void**)&pRdp);
    if (FAILED(hr) || !pRdp) {
        std::cerr << "MsRdpClient9: 0x" << std::hex << hr << std::endl;
        DestroyWindow(g_hwndParent);
        CoUninitialize();
        return 4;
    }

    // IOleObject — встраиваем контрол
    IOleObject* pOle = nullptr;
    hr = pRdp->QueryInterface(IID_IOleObject, (void**)&pOle);
    if (SUCCEEDED(hr) && pOle) {
        RECT rc;
        GetClientRect(g_hwndParent, &rc);
        pOle->DoVerb(OLEIVERB_INPLACEACTIVATE, nullptr, nullptr, 0,
                     g_hwndParent, &rc);
        pOle->Release();
    }

    // HWND контрола
    IOleInPlaceObject* pInPlace = nullptr;
    hr = pRdp->QueryInterface(IID_IOleInPlaceObject, (void**)&pInPlace);
    if (SUCCEEDED(hr) && pInPlace) {
        pInPlace->GetWindow(&g_hwndRdp);
        pInPlace->Release();
    }
    if (!g_hwndRdp || !IsWindow(g_hwndRdp)) {
        g_hwndRdp = GetWindow(g_hwndParent, GW_CHILD);
    }

    // IDispatch
    IDispatch* pDisp = nullptr;
    hr = pRdp->QueryInterface(IID_IDispatch, (void**)&pDisp);
    if (!pDisp) {
        std::cerr << "IDispatch: 0x" << std::hex << hr << std::endl;
        pRdp->Release();
        DestroyWindow(g_hwndParent);
        CoUninitialize();
        return 5;
    }

    // Server, Username, Domain
    { VARIANT v = VarBstr(host.c_str());     PutProp(pDisp, DISPID_SERVER, v);   ClearVar(v); }
    { VARIANT v = VarBstr(username.c_str()); PutProp(pDisp, DISPID_USERNAME, v); ClearVar(v); }
    if (!domain.empty()) {
        VARIANT v = VarBstr(domain.c_str()); PutProp(pDisp, DISPID_DOMAIN, v);   ClearVar(v);
    }

    // Desktop size
    { VARIANT v = VarLong(width);  PutProp(pDisp, DISPID_DESKTOPWIDTH, v);  ClearVar(v); }
    { VARIANT v = VarLong(height); PutProp(pDisp, DISPID_DESKTOPHEIGHT, v); ClearVar(v); }

    // SecuredSettings — пароль (ClearTextPassword = DISPID 0)
    IDispatch* pSec = GetPropDisp(pDisp, DISPID_SECURED);
    if (pSec) {
        VARIANT vp = VarBstr(password.c_str());
        PutProp(pSec, 0, vp);
        ClearVar(vp);
        pSec->Release();
    }

    // AdvancedSettings — порт (RDPPort = DISPID 1)
    IDispatch* pAdv = GetPropDisp(pDisp, DISPID_ADVANCED);
    if (pAdv) {
        { VARIANT v = VarLong(port); PutProp(pAdv, 1, v); ClearVar(v); }
        // EnableCredSspSupport = DISPID 0x115
        { VARIANT v = VarLong(1); PutProp(pAdv, 0x115, v); ClearVar(v); }
        pAdv->Release();
    }

    // Вывод HWND → stdout (Electron читает это)
    uintptr_t hwndOut = (uintptr_t)(g_hwndRdp ? g_hwndRdp : g_hwndParent);
    std::cout << "HWND:" << std::hex << hwndOut << std::endl;
    std::cout.flush();

    // Подключение
    hr = CallMethod(pDisp, DISPID_CONNECT);
    if (FAILED(hr)) {
        std::cerr << "Connect: 0x" << std::hex << hr << std::endl;
    }

    // stdin поток
    std::thread t(StdinThread);
    t.detach();

    // НЕ показываем окно — SetParent из Electron управляет видимостью

    // Message loop
    MSG msg = {};
    while (g_running && GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    // Cleanup
    CallMethod(pDisp, DISPID_DISCONNECT);
    pDisp->Release();
    pRdp->Release();
    DestroyWindow(g_hwndParent);
    CoUninitialize();
    return 0;
}

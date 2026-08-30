// rdp-com-host.cs
// MsTscAx ActiveX RDP-контрол, встроенный через WinForms AxHost.
//
// Три попытки вручную реализовать протокол OLE-контейнера в C++
// (IOleClientSite/IOleInPlaceSite/IOleInPlaceFrame, SetObjectRects,
// DPI-awareness) не заставили контрол реально нарисовать кадр, хотя
// подключение и логин проходили успешно (подтверждено подпиской на
// события контрола). AxHost в .NET реализует весь этот протокол
// полностью и корректно — этим кодом проверяем гипотезу, что дело
// именно в неполноте ручной OLE-реализации, а не в самом контроле.
//
// Все манипуляции с собственным окном (встраивание, позиция, видимость,
// фокус) сделаны через прямой P/Invoke ЗДЕСЬ, а не через FFI-библиотеку
// (koffi) из main-процесса Electron: koffi в v0.1.20 при первом запуске
// на пользовательской машине падал с «Module did not self-register» —
// её .node-бинарник копируется во временный файл на каждом старте (see
// git history), и это единственный настоящий native Node-addon в проекте
// помимо давно стабильных ssh2/cpu-features/bufferutil. Обычный .NET
// P/Invoke внутри уже скомпилированного .exe не подвержен этому классу
// проблем вообще: это не native Node-модуль, грузящийся через require()
// внутри V8/Node, а независимый Windows-процесс, которого Electron
// просто спавнит — тот же самый механизм, что уже используется для
// COM/RDP-логики этого файла.
//
// Сборка (компилятор уже в составе Windows, ничего ставить не надо;
// MsTscAxInterop.cs — вручную объявленная COM-обёртка, никаких внешних
// interop-сборок не требуется):
//   csc /target:winexe /platform:x64
//       /reference:System.Windows.Forms.dll,System.Drawing.dll,System.dll
//       rdp-com-host.cs MsTscAxInterop.cs /out:rdp-com-host.exe
//
// Запуск и протокол:
//   rdp-com-host.exe <host> <port> <username> [domain] [width] [height]
//   → stdin (первая строка, сразу после спавна): пароль в открытом виде.
//     Пароль НЕ передаётся аргументом командной строки — argv процесса
//     виден любому другому процессу на машине без повышенных прав через
//     Win32_Process.CommandLine / диспетчер задач (колонка «Командная
//     строка») / Process Explorer, пока процесс жив (а он живёт весь RDP-
//     сеанс). stdin таким способом не читается.
//   → stdout: "HWND:1a2b3c4d"
//   → stdin (далее):  "quit" / "resize W H" / "embed <ownerHwndHex>" / "setrect x y w h"
//             / "show" / "hide" / "foreground" / "focus"

using System;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using MsTscAxMinimal;

// AxHost — абстрактный класс; минимальный конкретный наследник только
// открывает protected GetOcx() наружу, чтобы достать «сырой» COM-объект
// контрола, приводимый к интерфейсам из MsTscAxInterop.cs.
internal sealed class GenericAxHost : AxHost
{
    public GenericAxHost(string clsid) : base(clsid) { }
    public object Ocx { get { return GetOcx(); } }
}

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 — тот же контекст, что и у
    // Electron-родителя; несовпадение DPI-контекстов между cross-process
    // родителем и ребёнком — известная причина немого рендеринга.
    private static readonly IntPtr PerMonitorV2 = new IntPtr(-4);

    private const int GWL_EXSTYLE = -20;
    private const int GWLP_HWNDPARENT = -8;
    private const uint GW_OWNER = 4;
    private const uint WS_EX_APPWINDOW = 0x00040000;
    private const uint WS_EX_TOOLWINDOW = 0x00000080;
    private const int SW_HIDE = 0;
    private const int SW_SHOWNA = 8;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;

    [STAThread]
    private static int Main(string[] args)
    {
        try { SetProcessDpiAwarenessContext(PerMonitorV2); } catch { /* недоступно на старых сборках — не критично */ }

        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: rdp-com-host <host> <port> <user> [domain] [w] [h]  (пароль читается первой строкой stdin)");
            return 1;
        }
        string host = args[0];
        int port = int.Parse(args[1]);
        string username = args[2];
        string domain = args.Length > 3 ? args[3] : "";
        int w0, h0;
        int width = args.Length > 4 && int.TryParse(args[4], out w0) ? Math.Max(100, w0) : 1024;
        int height = args.Length > 5 && int.TryParse(args[5], out h0) ? Math.Max(100, h0) : 768;

        // Пароль — первая строка stdin, а не аргумент командной строки (см.
        // комментарий в шапке файла). Родитель пишет её сразу после спавна,
        // до любых остальных stdin-команд, поэтому чтение блокирующее и без
        // таймаута: она уже либо в буфере пайпа, либо появится очень скоро.
        string password = Console.In.ReadLine() ?? "";

        Application.EnableVisualStyles();

        var form = new Form
        {
            FormBorderStyle = FormBorderStyle.None,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(0, 0),
            Size = new Size(width, height),
            ShowInTaskbar = false,
            Text = "RdpComHost"
        };

        // CLSID_MsRdpClient9NotSafeForScripting — та же версия контрола,
        // что и в C++-хосте.
        var ax = new GenericAxHost("{8B918B82-7985-4C24-89DF-C33AD2BBFBCD}")
        {
            Dock = DockStyle.Fill
        };

        // BeginInit/EndInit — обязательная последовательность активации
        // AxHost (её же генерирует Designer). Без неё CreateControl создаёт
        // HWND, но реальный COM-объект внутри не активируется: GetOcx()
        // возвращает null.
        ((System.ComponentModel.ISupportInitialize)ax).BeginInit();
        form.Controls.Add(ax);
        ((System.ComponentModel.ISupportInitialize)ax).EndInit();

        // Форсируем создание нативных HWND формы и контрола ДО показа —
        // main-процесс сам управляет позицией/размером/видимостью окна
        // через команды в stdin (псевдо-встраивание через GWLP_HWNDPARENT),
        // сюда мы окно никогда не показываем напрямую.
        IntPtr formHandle = form.Handle;
        ax.CreateControl();

        IMsRdpClient9Minimal rdp = (IMsRdpClient9Minimal)ax.Ocx;
        rdp.Server = host;
        rdp.UserName = username;
        if (!string.IsNullOrEmpty(domain)) rdp.Domain = domain;
        rdp.DesktopWidth = width;
        rdp.DesktopHeight = height;

        IMsRdpClientAdvancedSettings6Minimal adv = (IMsRdpClientAdvancedSettings6Minimal)rdp.AdvancedSettings2;
        adv.RDPPort = port;
        try { adv.EnableCredSspSupport = true; } catch { /* нет в старых версиях */ }
        try { adv.AuthenticationLevel = 0; } catch { /* нет в старых версиях */ }
        try { adv.SmartSizing = true; } catch { /* нет в старых версиях */ }
        try
        {
            adv.ClearTextPassword = password;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("SetPassword: " + ex.Message);
        }

        // UpdateSessionDisplaySettings — реальное изменение разрешения сессии
        // (не просто масштабирование уже отрисованного кадра, как SmartSizing,
        // который на практике не подхватывает resize контейнера). Пока канал
        // DisplayControl не готов — вызов падает с E_UNEXPECTED (0x8000FFFF).
        // Первая resize-команда от main-процесса приходит почти сразу после
        // встраивания (сотни мс) — а полный логин занимает 5-6 секунд, иногда
        // больше, поэтому окно retry должно быть заметно больше типичного
        // логина, а не привязано к какому-то одному событию контрола.
        const int MaxDisplaySizeAttempts = 40;
        Action<int, int, int> applyDisplaySize = null;
        applyDisplaySize = (rw, rh, attemptsLeft) =>
        {
            try
            {
                rdp.UpdateSessionDisplaySettings((uint)rw, (uint)rh, (uint)rw, (uint)rh, 0, 100, 100);
            }
            catch (Exception ex2)
            {
                if (attemptsLeft <= 1)
                {
                    Console.Error.WriteLine("UpdateSessionDisplaySettings: " + ex2.Message);
                    return;
                }
                var retryTimer = new System.Windows.Forms.Timer();
                retryTimer.Interval = 400;
                retryTimer.Tick += (s, e) =>
                {
                    retryTimer.Stop();
                    retryTimer.Dispose();
                    applyDisplaySize(rw, rh, attemptsLeft - 1);
                };
                retryTimer.Start();
            }
        };

        Console.Out.WriteLine("HWND:" + formHandle.ToInt64().ToString("x"));
        Console.Out.Flush();

        try
        {
            rdp.Connect();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Connect: " + ex.Message);
        }

        var stdinThread = new Thread(() =>
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line == "quit")
                {
                    try { form.Invoke((MethodInvoker)(() => form.Close())); } catch { /* форма уже закрыта */ }
                    break;
                }
                else if (line.StartsWith("resize ", StringComparison.Ordinal))
                {
                    string[] parts = line.Split(' ');
                    int rw, rh;
                    if (parts.Length == 3 && int.TryParse(parts[1], out rw) && int.TryParse(parts[2], out rh))
                    {
                        try
                        {
                            form.Invoke((MethodInvoker)(() =>
                            {
                                form.Size = new Size(rw, rh);
                                applyDisplaySize(rw, rh, MaxDisplaySizeAttempts);
                            }));
                        }
                        catch (Exception ex) { Console.Error.WriteLine("resize failed: " + ex.Message); }
                    }
                }
                else if (line.StartsWith("embed ", StringComparison.Ordinal))
                {
                    string[] parts = line.Split(' ');
                    long ownerVal;
                    if (parts.Length == 2 && long.TryParse(parts[1], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ownerVal))
                    {
                        IntPtr owner = new IntPtr(ownerVal);
                        try
                        {
                            form.Invoke((MethodInvoker)(() =>
                            {
                                // Настоящий WS_CHILD + SetParent здесь не работает: Electron/
                                // Chromium композитит своё окно через DirectComposition, который
                                // рисует контент в обход классического Win32 Z-порядка — «сырой»
                                // дочерний HWND остаётся чёрным независимо от Z-позиции и
                                // GPU-ускорения (подтверждено диагностикой: тот же самый
                                // механизм отлично работает при встраивании в обычное,
                                // не-Chromium окно). Псевдо-встраивание: окно остаётся ОТДЕЛЬНЫМ
                                // top-level окном (без рамки/заголовка/в панели задач — уже
                                // задано выше), привязанным к родителю через GWLP_HWNDPARENT
                                // (owned window) — так оно рисуется собственным DWM-композитингом,
                                // но следует за родителем по Z-порядку и автоматически
                                // прячется/показывается при его minimize/restore.
                                ShowWindow(formHandle, SW_HIDE);
                                SetWindowLongPtr(formHandle, GWLP_HWNDPARENT, owner);
                                IntPtr actualOwner = GetWindow(formHandle, GW_OWNER);
                                if (actualOwner != owner)
                                {
                                    Console.Error.WriteLine("embed: GWLP_HWNDPARENT не привязал (actual=" + actualOwner.ToInt64().ToString("x") + ")");
                                    return;
                                }
                                long ex2 = GetWindowLongPtr(formHandle, GWL_EXSTYLE).ToInt64() & 0xffffffffL;
                                SetWindowLongPtr(formHandle, GWL_EXSTYLE, new IntPtr((ex2 & ~(long)WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW));
                            }));
                        }
                        catch (Exception ex) { Console.Error.WriteLine("embed failed: " + ex.Message); }
                    }
                }
                else if (line.StartsWith("setrect ", StringComparison.Ordinal))
                {
                    string[] parts = line.Split(' ');
                    int rx, ry, rw2, rh2;
                    if (parts.Length == 5
                        && int.TryParse(parts[1], out rx) && int.TryParse(parts[2], out ry)
                        && int.TryParse(parts[3], out rw2) && int.TryParse(parts[4], out rh2))
                    {
                        try
                        {
                            form.Invoke((MethodInvoker)(() =>
                                SetWindowPos(formHandle, IntPtr.Zero, rx, ry, Math.Max(1, rw2), Math.Max(1, rh2), SWP_NOACTIVATE | SWP_FRAMECHANGED)));
                        }
                        catch (Exception ex) { Console.Error.WriteLine("setrect failed: " + ex.Message); }
                    }
                }
                else if (line == "show")
                {
                    try
                    {
                        form.Invoke((MethodInvoker)(() =>
                        {
                            ShowWindow(formHandle, SW_SHOWNA);
                            // Owned-окна и так держатся над владельцем, но явно поднимаем в
                            // Z-порядке — на случай если поверх успело встать что-то ещё.
                            SetWindowPos(formHandle, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                        }));
                    }
                    catch (Exception ex) { Console.Error.WriteLine("show failed: " + ex.Message); }
                }
                else if (line == "hide")
                {
                    try { form.Invoke((MethodInvoker)(() => ShowWindow(formHandle, SW_HIDE))); }
                    catch (Exception ex) { Console.Error.WriteLine("hide failed: " + ex.Message); }
                }
                else if (line == "foreground")
                {
                    try { form.Invoke((MethodInvoker)(() => SetForegroundWindow(formHandle))); }
                    catch (Exception ex) { Console.Error.WriteLine("foreground failed: " + ex.Message); }
                }
                else if (line == "focus")
                {
                    try
                    {
                        form.Invoke((MethodInvoker)(() =>
                        {
                            // Перед фокусом поднимаем окно в Z-порядке. AttachThreadInput не
                            // нужен: SetFocus вызывается на СВОЁМ окне из СВОЕГО же потока
                            // (в отличие от прежней версии, где фокус пытался поставить сам
                            // Electron-процесс на чужое окно из другого процесса).
                            SetWindowPos(formHandle, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                            SetFocus(formHandle);
                        }));
                    }
                    catch (Exception ex) { Console.Error.WriteLine("focus failed: " + ex.Message); }
                }
            }
        });
        stdinThread.IsBackground = true;
        stdinThread.Start();

        Application.Run(form);

        try { rdp.Disconnect(); } catch { /* сессия уже могла завершиться */ }
        return 0;
    }
}

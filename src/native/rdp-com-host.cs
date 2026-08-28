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
// Сборка (компилятор уже в составе Windows, ничего ставить не надо;
// MsTscAxInterop.cs — вручную объявленная COM-обёртка, никаких внешних
// interop-сборок не требуется):
//   csc /target:winexe /platform:x64
//       /reference:System.Windows.Forms.dll,System.Drawing.dll,System.dll
//       rdp-com-host.cs MsTscAxInterop.cs /out:rdp-com-host.exe
//
// Запуск и протокол:
//   rdp-com-host.exe <host> <port> <username> <password> [domain] [width] [height]
//   → stdout: "HWND:1a2b3c4d"
//   → stdin:  "quit" / "resize W H"

using System;
using System.Drawing;
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

    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 — тот же контекст, что и у
    // Electron-родителя; несовпадение DPI-контекстов между cross-process
    // родителем и ребёнком — известная причина немого рендеринга.
    private static readonly IntPtr PerMonitorV2 = new IntPtr(-4);

    [STAThread]
    private static int Main(string[] args)
    {
        try { SetProcessDpiAwarenessContext(PerMonitorV2); } catch { /* недоступно на старых сборках — не критично */ }

        if (args.Length < 4)
        {
            Console.Error.WriteLine("Usage: rdp-com-host <host> <port> <user> <pass> [domain] [w] [h]");
            return 1;
        }
        string host = args[0];
        int port = int.Parse(args[1]);
        string username = args[2];
        string password = args[3];
        string domain = args.Length > 4 ? args[4] : "";
        int w0, h0;
        int width = args.Length > 5 && int.TryParse(args[5], out w0) ? Math.Max(100, w0) : 1024;
        int height = args.Length > 6 && int.TryParse(args[6], out h0) ? Math.Max(100, h0) : 768;

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
        // (псевдо-встраивание через GWLP_HWNDPARENT, см. win32-engine.ts),
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
                if (line.StartsWith("resize ", StringComparison.Ordinal))
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
            }
        });
        stdinThread.IsBackground = true;
        stdinThread.Start();

        Application.Run(form);

        try { rdp.Disconnect(); } catch { /* сессия уже могла завершиться */ }
        return 0;
    }
}

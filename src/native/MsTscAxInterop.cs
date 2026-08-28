// MsTscAxInterop.cs
// Минимальная ручная COM-обёртка над MsRdpClient9NotSafeForScripting
// (mstscax.dll, тот же ActiveX-контрол, что использует mstsc.exe) —
// только те члены, что реально нужны rdp-com-host.cs. Написана вручную
// через [ComImport]/[Guid]/[DispId] вместо генерации через tlbimp
// (недоступен без Windows SDK) или использования чужой interop-сборки:
// GUID интерфейсов и DISPID членов — публичный, документированный COM API
// Microsoft (MS-RDPESC/MSTSCAx), не защищены авторским правом и не зависят
// от чьей-либо конкретной сборки. Значения проверены рефлексией над
// реальной tlbimp-сгенерированной сборкой и рабочим тестом на живом сервере.
using System;
using System.Runtime.InteropServices;

namespace MsTscAxMinimal
{
    [ComImport]
    [Guid("28904001-04b6-436c-a55b-0af1a0883dc9")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IMsRdpClient9Minimal
    {
        [DispId(1)]
        string Server { get; set; }

        [DispId(2)]
        string Domain { get; set; }

        [DispId(3)]
        string UserName { get; set; }

        [DispId(12)]
        int DesktopWidth { get; set; }

        [DispId(13)]
        int DesktopHeight { get; set; }

        [DispId(30)]
        void Connect();

        [DispId(31)]
        void Disconnect();

        [DispId(101)]
        object AdvancedSettings2 { get; }

        [DispId(802)]
        void UpdateSessionDisplaySettings(
            uint desktopWidth, uint desktopHeight,
            uint physicalWidth, uint physicalHeight,
            uint orientation, uint desktopScaleFactor, uint deviceScaleFactor);
    }

    [ComImport]
    [Guid("222c4b5d-45d9-4df0-a7c6-60cf9089d285")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IMsRdpClientAdvancedSettings6Minimal
    {
        [DispId(108)]
        int RDPPort { get; set; }

        [DispId(17)]
        bool EnableCredSspSupport { get; set; }

        [DispId(212)]
        uint AuthenticationLevel { get; set; }

        [DispId(184)]
        bool SmartSizing { get; set; }

        [DispId(186)]
        string ClearTextPassword { set; }
    }
}

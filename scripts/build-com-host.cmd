@echo off
rem Сборка rdp-com-host.exe — MsTscAx COM-хост (замена mstsc.exe).
rem Требуется VS 2022 Build Tools (vcvars64). Запуск: scripts\build-com-host.cmd
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo vswhere not found: %VSWHERE%
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
if not defined VSDIR (
  echo VS 2022 with VC tools not found
  exit /b 1
)
call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1
cd /d "%~dp0..\src\native"
cl /nologo /std:c++17 /EHsc /O2 /D_UNICODE /DUNICODE rdp-com-host.cpp /link user32.lib ole32.lib oleaut32.lib shell32.lib /out:rdp-com-host.exe
if errorlevel 1 exit /b 1
echo BUILT: %CD%\rdp-com-host.exe
endlocal

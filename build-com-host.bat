@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd /d "C:\Users\savchenkosv\Documents\Projects\rdp\src\native"
cl /std:c++17 /EHsc /O2 /D_UNICODE /DUNICODE rdp-com-host.cpp ^
   /Fe:rdp-com-host.exe ^
   /link user32.lib ole32.lib oleaut32.lib shell32.lib /SUBSYSTEM:CONSOLE
echo EXIT=%ERRORLEVEL%

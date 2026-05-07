Set oShell = CreateObject("WScript.Shell")
oShell.Run "cmd /c start """" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Xova\start_xova.ps1""", 0, False
Set oShell = Nothing

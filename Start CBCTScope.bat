@echo off
rem Double-click starter for Windows: installs on first run, starts the viewer, opens the browser.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet. Opening nodejs.org: download the LTS installer,
  echo run it with the default options, then double-click this file again.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: downloading the viewer's components. This runs once and takes a few minutes.
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

rem Open the browser only once the server actually answers, never onto a dead error page.
start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{$c=New-Object Net.Sockets.TcpClient('127.0.0.1',3810);$c.Close();Start-Process 'http://localhost:3810';break}catch{Start-Sleep 1}}"

echo Starting CBCTScope. Leave this window open while reading; close it to stop.
call npm run dev

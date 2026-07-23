@echo off
setlocal
cd /d "%~dp0"

echo.
echo  ============================================
echo   Jarvis Turismo — buscar videos YouTube
echo   (mismos POIs de data\tourism-catalog.json)
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js en el PATH.
  echo Instala Node LTS desde https://nodejs.org y vuelve a intentar.
  pause
  exit /b 1
)

if not exist "data\tourism-catalog.json" (
  echo [ERROR] Falta data\tourism-catalog.json
  pause
  exit /b 1
)

if not exist "tools\lib\yt-search.js" (
  echo [ERROR] Falta tools\lib\yt-search.js
  pause
  exit /b 1
)

echo Buscando videos... esto puede tardar unos minutos.
echo No cierres esta ventana.
echo.

node "tools\find-tourism-videos.js"
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
  echo [ERROR] La busqueda fallo (codigo %ERR%).
  pause
  exit /b %ERR%
)

echo Abriendo resultados...
if exist "tools\out\tourism-videos.md" (
  start "" "tools\out\tourism-videos.md"
)

echo.
echo Listo. Revisa tools\out\tourism-videos.md
echo Copia los ID buenos a youtubeCandidates en data\tourism-catalog.json
echo.
pause
endlocal

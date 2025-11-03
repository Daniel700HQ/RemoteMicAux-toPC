@echo off
REM Establece el título de la ventana de la consola para que sea fácil de identificar.
title Lanzador del Frontend

:menu
REM Limpia la pantalla para mostrar el menú de forma clara.
cls

REM Muestra las opciones disponibles al usuario.
echo ====================================================
echo      LANZADOR DEL PROYECTO FRONTEND DE STREAMING
echo ====================================================
echo.
echo Por favor, selecciona la accion que deseas realizar:
echo.
echo   1 - Solo instalar dependencias (npm install)
echo.
echo   2 - Solo iniciar servidor de desarrollo (npm run dev)
echo.
echo   3 - Instalar dependencias y LUEGO iniciar (Recomendado la primera vez)
echo.
echo   4 - Salir
echo.

REM Pide al usuario que elija una opción y guarda la respuesta en la variable 'choice'.
set /p choice="Escribe el numero (1, 2, 3 o 4) y presiona Enter: "

REM Comprueba la elección del usuario y salta a la sección correspondiente.
if "%choice%"=="1" goto install_only
if "%choice%"=="2" goto dev_only
if "%choice%"=="3" goto install_and_dev
if "%choice%"=="4" goto exit

REM Si el usuario introduce algo no válido, muestra un error y vuelve al menú.
echo.
echo "%choice%" no es una opcion valida. Por favor, intenta de nuevo.
echo.
pause
goto menu


:install_only
cls
echo ====================================================
echo       INSTALANDO DEPENDENCIAS (npm install)
echo ====================================================
echo.
echo Esto puede tardar varios minutos...
echo.
npm install
echo.
echo ----------------------------------------------------
echo  Proceso finalizado. Dependencias instaladas.
echo ----------------------------------------------------
echo.
pause
REM Vuelve al menú principal después de terminar.
goto menu


:dev_only
cls
echo ====================================================
echo      INICIANDO SERVIDOR DE DESARROLLO (npm run dev)
echo ====================================================
echo.
echo El servidor se esta iniciando. Cuando veas una URL
echo (ej. https://localhost:5173), abrela en tu navegador.
echo.
echo Para detener el servidor, cierra esta ventana o
echo presiona CTRL+C en la terminal.
echo.
npm run dev
REM 'npm run dev' es un proceso continuo, el script esperará aquí hasta que se cierre.
goto end


:install_and_dev
cls
echo ====================================================
echo       PASO 1 de 2: INSTALANDO DEPENDENCIAS
echo ====================================================
echo.
npm install

REM Comprueba si el comando anterior (npm install) tuvo errores.
REM %ERRORLEVEL% es 0 si no hubo errores.
if %ERRORLEVEL% neq 0 (
    echo.
    echo ----------------------------------------------------
    echo  ERROR: La instalacion de dependencias fallo.
    echo  Por favor, revisa los mensajes de error de arriba.
    echo ----------------------------------------------------
    echo.
    pause
    goto menu
)

cls
echo ====================================================
echo     PASO 2 de 2: INICIANDO SERVIDOR DE DESARROLLO
echo ====================================================
echo.
echo Dependencias instaladas correctamente.
echo Iniciando el servidor...
echo.
npm run dev
goto end


:exit
REM Cierra la ventana de la consola.
exit

:end
REM Punto final del script.
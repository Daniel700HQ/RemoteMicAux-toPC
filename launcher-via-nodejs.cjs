const readline = require('readline');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- Configuración de Colores para la Consola ---
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

// --- Configuración de Rutas y Nombres de Archivos ---
const backendDir = path.join(__dirname, 'backend');
const frontendDir = path.join(__dirname, 'frontend');
const backendScript = 'server.py';
const certPath = path.join(backendDir, 'cert.pem');
const keyPath = path.join(backendDir, 'key.pem');

// --- Interfaz de Línea de Comandos ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Función genérica para ejecutar comandos. Ahora captura stderr para un manejo de errores inteligente.
 */
function runCommand(command, args, cwd, callback) {
  console.log(colors.yellow, `\n▶ Ejecutando: ${command} ${args.join(' ')} en ${cwd}`, colors.reset);
  
  const child = spawn(command, args, { cwd, shell: true });
  let stderrData = ''; // Variable para capturar la salida de error

  child.stdout.pipe(process.stdout);

  // Mostramos el error en tiempo real, pero también lo capturamos
  child.stderr.on('data', (data) => {
    process.stderr.write(data);
    stderrData += data.toString();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      // --- INICIO DE LA LÓGICA DE MANEJO DE ERRORES ---
      // Comprobamos si el error es el de "Puerto en uso"
      if (stderrData.includes('Errno 10048')) {
        console.error(colors.red + colors.bright, "\n❌ ERROR: El puerto 8765 ya está en uso.", colors.reset);
        console.error(colors.yellow, "Esto usualmente significa que ya tienes el servidor del backend corriendo en otra terminal.", colors.reset);
        console.error(colors.yellow, "Por favor, detén el otro proceso (con Ctrl+C) o cierra la otra terminal e inténtalo de nuevo.", colors.reset);
        // Devolvemos un error "manejado" para que el menú pueda continuar
        return callback(null, { handled: true }); 
      }
      // --- FIN DE LA LÓGICA DE MANEJO DE ERRORES ---

      console.error(colors.red, `\n❌ El comando terminó con un error inesperado (código: ${code})`, colors.reset);
      return callback(new Error(`El comando falló con el código ${code}`));
    }
    console.log(colors.green, `\n✔ Comando finalizado exitosamente.`, colors.reset);
    callback(null);
  });

  child.on('error', (err) => {
    console.error(colors.red, `\n❌ Error al intentar ejecutar el comando: ${err.message}`, colors.reset);
    callback(err);
  });
}

/**
 * Comprueba si openssl está disponible.
 */
function checkOpenSSL(callback) {
  const check = spawn('openssl', ['version'], { shell: true });
  check.on('error', () => callback(false));
  check.on('close', (code) => callback(code === 0));
}

/**
 * Verifica/genera los certificados SSL.
 */
function ensureCertificates(callback) {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log(colors.green, "✔ Certificados SSL encontrados.", colors.reset);
    callback();
    return;
  }
  console.log(colors.yellow, "\n⚠️  Certificados SSL no encontrados.", colors.reset);
  checkOpenSSL(isAvailable => {
    if (!isAvailable) {
      console.error(colors.red + colors.bright, "\n[ACCIÓN REQUERIDA] El comando 'openssl' no se encuentra.", colors.reset);
      if (process.platform === 'win32') {
        console.error(colors.yellow, "Para generar certificados, este script necesita 'openssl'. La forma más fácil es usar la terminal 'Git Bash'.", colors.reset);
      } else {
        console.error(colors.yellow, "Por favor, instala OpenSSL con el gestor de paquetes de tu sistema.", colors.reset);
      }
      showMainMenu();
      return;
    }
    console.log(colors.cyan, "Generando certificados auto-firmados...", colors.reset);
    const opensslArgs = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '365', '-subj', '"/C=XX/ST=State/L=City/O=Organization/OU=OrgUnit/CN=localhost"'];
    runCommand('openssl', opensslArgs, backendDir, (err) => {
      if (err) {
        console.error(colors.red, "❌ Falló la generación de certificados.", colors.reset);
        showMainMenu();
      } else {
        console.log(colors.green, "✔ Certificados generados exitosamente.", colors.reset);
        callback();
      }
    });
  });
}

// --- Menú Principal Unificado ---
function showMainMenu() {
  console.log(colors.magenta, "\n--- Centro de Control del Proyecto ---", colors.reset);
  rl.question(
`¿Qué deseas hacer en ${colors.bright}ESTA${colors.reset} terminal?

  ${colors.cyan}[1]${colors.reset} Iniciar Servidor del Backend
  ${colors.cyan}[2]${colors.reset} Iniciar Servidor de Desarrollo del Frontend

  --- Tareas de Instalación y Mantenimiento ---
  ${colors.cyan}[3]${colors.reset} Instalar TODAS las dependencias (Backend y Frontend)
  ${colors.cyan}[4]${colors.reset} Instalar solo dependencias del Backend
  ${colors.cyan}[5]${colors.reset} Instalar solo dependencias del Frontend

  ${colors.cyan}[0]${colors.reset} Salir

Tu elección: `, (choice) => {
    switch (choice.trim()) {
      case '1':
        console.log(colors.bright + colors.yellow, "\nIniciando el servidor del Backend...", colors.reset);
        ensureCertificates(() => {
          runCommand('python', ['-u', backendScript], backendDir, (err, result) => {
            // Si el error fue manejado (ej. puerto en uso), volvemos al menú.
            if (result && result.handled) {
              showMainMenu();
            } else {
              rl.close();
            }
          });
        });
        break;

      case '2':
        console.log(colors.bright + colors.yellow, "\nIniciando el servidor del Frontend...", colors.reset);
        console.log(colors.yellow, "Para el backend, abre una NUEVA TERMINAL y ejecuta 'node menu.cjs'.", colors.reset);
        runCommand('npm', ['run', 'dev'], frontendDir, () => rl.close());
        break;

      case '3':
        console.log("\nInstalando dependencias del Backend...");
        runCommand('pip', ['install', '-r', 'requirements.txt'], backendDir, (err) => {
          if (err) { showMainMenu(); return; }
          console.log("\nInstalando dependencias del Frontend...");
          runCommand('npm', ['install'], frontendDir, () => {
            console.log(colors.green, "\n¡Todas las dependencias han sido instaladas!", colors.reset);
            showMainMenu();
          });
        });
        break;

      case '4':
        runCommand('pip', ['install', '-r', 'requirements.txt'], backendDir, () => showMainMenu());
        break;
      
      case '5':
        runCommand('npm', ['install'], frontendDir, () => showMainMenu());
        break;

      case '0':
        rl.close();
        break;
      
      default:
        console.log(colors.red, "Opción no válida. Por favor, intenta de nuevo.", colors.reset);
        showMainMenu();
        break;
    }
  });
}

// --- Inicio del Script ---
console.log(colors.bright + colors.green, "--- Asistente de Inicio del Proyecto de Streaming de Audio ---", colors.reset);
showMainMenu();

rl.on('close', () => {
  console.log(colors.bright + colors.cyan, '\nAsistente finalizado. ¡Hasta luego!', colors.reset);
  process.exit(0);
});
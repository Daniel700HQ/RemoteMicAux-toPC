import asyncio
import ssl
import websockets
import pathlib
import pyaudio
import json

# --- CONFIGURACIÓN DE RUTAS (para SSL) ---
SCRIPT_DIR = pathlib.Path(__file__).parent.resolve()
CERT_PATH = SCRIPT_DIR / "cert.pem"
KEY_PATH = SCRIPT_DIR / "key.pem"

def get_output_devices():
    """
    Obtiene y devuelve una lista de diccionarios con la información
    de los dispositivos de salida de audio disponibles.
    """
    p = pyaudio.PyAudio()
    devices = []
    for i in range(p.get_device_count()):
        info = p.get_device_info_by_index(i)
        if info['maxOutputChannels'] > 0:
            devices.append({'index': i, 'name': info['name']})
    p.terminate()
    return devices

async def audio_handler(websocket):
    """
    Maneja la conexión WebSocket completa:
    1. Espera la configuración de audio del cliente (sample rate, format, etc.).
    2. Envía la lista de dispositivos de audio al cliente.
    3. Espera la selección del cliente.
    4. Abre el stream en el dispositivo seleccionado y reproduce el audio.
    """
    print("Cliente conectado. Esperando configuración de audio...")
    
    format_map = {
        1: pyaudio.paInt8,
        2: pyaudio.paInt16,
        3: pyaudio.paInt24,
        4: pyaudio.paFloat32
    }

    try:
        config_message = await websocket.recv()
        config_data = json.loads(config_message)

        if config_data.get("type") == "config":
            audio_params = config_data.get("data", {})
            SAMPLE_RATE = int(audio_params.get("sampleRate"))
            CHANNELS = int(audio_params.get("channels"))
            SAMPLE_WIDTH_BYTES = int(audio_params.get("sampleWidthBytes"))
            FRAMES_PER_BUFFER = int(audio_params.get("framesPerBuffer"))
            
            FORMAT = format_map.get(SAMPLE_WIDTH_BYTES)
            if not FORMAT:
                raise ValueError(f"Ancho de muestra no válido: {SAMPLE_WIDTH_BYTES} bytes")

            print("="*60)
            print("Configuración de audio recibida del cliente:")
            print(f"  - Sample Rate: {SAMPLE_RATE} Hz")
            print(f"  - Canales: {CHANNELS}")
            print(f"  - Formato: {SAMPLE_WIDTH_BYTES} bytes por muestra (PyAudio format {FORMAT})")
            print(f"  - Tamaño de Búfer (Hint): {FRAMES_PER_BUFFER} frames")
            print("="*60)
        else:
            print("Mensaje inicial no era de configuración. Desconectando.")
            return

        device_list = get_output_devices()
        await websocket.send(json.dumps({ "type": "devices", "data": device_list }))
        print("Configuración aceptada. Enviando lista de dispositivos.")

    except Exception as e:
        print(f"Error durante la configuración inicial: {e}")
        await websocket.close(code=1011, reason=f"Error de configuración: {e}")
        return

    selected_device_index = None
    try:
        message = await websocket.recv()
        data = json.loads(message)
        if data.get("type") == "select_device":
            selected_device_index = int(data.get("data"))
            print(f"Cliente seleccionó el dispositivo con índice: {selected_device_index}")
        else:
            print("Mensaje de selección de dispositivo no válido.")
            return
    except (json.JSONDecodeError, ValueError, websockets.exceptions.ConnectionClosed):
        print("El cliente se desconectó o envió datos inválidos antes de seleccionar un dispositivo.")
        return

    p = pyaudio.PyAudio()
    stream = None
    try:
        stream = p.open(format=FORMAT,
                        channels=CHANNELS,
                        rate=SAMPLE_RATE,
                        output=True,
                        output_device_index=selected_device_index,
                        frames_per_buffer=FRAMES_PER_BUFFER)
        
        print("Stream de audio iniciado. Reproduciendo en tiempo real...")

        async for audio_chunk in websocket:
            if isinstance(audio_chunk, bytes):
                stream.write(audio_chunk)

    except websockets.exceptions.ConnectionClosedOK:
        print("\nEl cliente cerró la conexión correctamente.")
    except Exception as e:
        print(f"\nOcurrió un error inesperado durante el streaming: {e}")
    finally:
        if stream:
            stream.stop_stream()
            stream.close()
        p.terminate()
        print("Recursos de audio liberados.")


async def main():
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        ssl_context.load_cert_chain(CERT_PATH, KEY_PATH)
    except FileNotFoundError:
        # --- INICIO DE LA MODIFICACIÓN ---
        # Mensaje de error mejorado con guía de generación de certificados.
        print("="*80)
        print(" ERROR: No se encontraron los archivos de certificado SSL ('cert.pem' y 'key.pem').")
        print(f" El servidor los está buscando en el directorio: {SCRIPT_DIR}")
        print("="*80)
        print("\n--- GUÍA RÁPIDA PARA GENERAR CERTIFICADOS AUTO-FIRMADOS (PARA DESARROLLO) ---\n")
        print("Para que el servidor seguro (WSS) y el acceso al micrófono funcionen,")
        print("necesitas un certificado SSL. Puedes generar uno localmente con OpenSSL.\n")
        print("1. Abre una terminal que tenga OpenSSL. En Windows, 'Git Bash' es una excelente opción.")
        print("2. Asegúrate de estar en el directorio de este proyecto.")
        print("3. Copia y pega el siguiente comando en tu terminal y presiona Enter:\n")
        print("   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365\n")
        print("Explicación del comando:")
        print("  - 'openssl req':        Inicia la solicitud de certificado.")
        print("  - '-x509':              Crea un certificado auto-firmado en lugar de una solicitud.")
        print("  - '-newkey rsa:2048':   Genera una nueva clave privada RSA de 2048 bits.")
        print("  - '-nodes':             No encripta la clave (sin contraseña, ideal para desarrollo).")
        print("  - '-keyout key.pem':    Guarda la clave privada en 'key.pem'.")
        print("  - '-out cert.pem':      Guarda el certificado en 'cert.pem'.")
        print("  - '-days 365':          Establece la validez del certificado por 1 año.\n")
        print("La terminal te pedirá información como 'Country Name', etc. Puedes presionar 'Enter'")
        print("en cada pregunta para aceptar los valores por defecto sin problemas.\n")
        print("Una vez finalizado el comando, tendrás los archivos 'key.pem' y 'cert.pem'")
        print("necesarios en el directorio. ¡Vuelve a ejecutar el servidor!\n")
        print("="*80)
        # --- FIN DE LA MODIFICACIÓN ---
        return

    async with websockets.serve(audio_handler, "0.0.0.0", 8765, ssl=ssl_context):
        print(f"\nServidor WebSocket seguro iniciado en wss://0.0.0.0:8765")
        print("Esperando conexión del cliente...")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServidor detenido por el usuario (Ctrl+C).")
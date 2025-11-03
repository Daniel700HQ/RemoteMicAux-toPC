import React, { useState, useRef, useEffect, useCallback } from 'react';
console.log("cuando necesites usar este programa para que un dispositivo externo funcione como microfono tu PC antes debes instalar VB-Cable en windows, y  hacer que este programa suene en ''Cable in 16ch'', y en microfono del sistema de windows configuras que la salida sea ''Cable Output VB Cable audio''  ")

// --- Componente VUMeter (sin cambios) ---
function VUMeter({ analyserNode }) {
  const levelRef = useRef(null);
  useEffect(() => {
    if (!analyserNode) return;
    let animationFrameId;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    const draw = () => {
      if (levelRef.current) {
        analyserNode.getByteFrequencyData(dataArray);
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] > max) max = dataArray[i];
        }
        const level = (max / 255) * 100;
        levelRef.current.style.width = `${level}%`;
        if (level > 95) levelRef.current.style.backgroundColor = '#f44336';
        else if (level > 80) levelRef.current.style.backgroundColor = '#FFC107';
        else levelRef.current.style.backgroundColor = '#4CAF50';
      }
      animationFrameId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animationFrameId);
  }, [analyserNode]);
  const barStyle = { width: '100%', height: '20px', backgroundColor: '#333', borderRadius: '5px', overflow: 'hidden', border: '1px solid #555' };
  const levelStyle = { height: '100%', width: '0%', backgroundColor: '#4CAF50', transition: 'background-color 0.2s linear' };
  return <div style={barStyle}><div ref={levelRef} style={levelStyle}></div></div>;
}

// --- Componente del Modal de Logs (sin cambios) ---
function LogModal({ logs, onClose }) {
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        <h2 style={{marginTop: 0}}>Logs de Conexión</h2>
        <div style={styles.logContainer}>
          {logs.map((log, index) => (
            <p key={index} style={styles.logEntry}>
              <span style={{color: '#888'}}>{log.timestamp}: </span>
              <span style={{color: log.type === 'error' ? '#dc3545' : '#e0e0e0'}}>{log.message}</span>
            </p>
          ))}
        </div>
        <button onClick={onClose} style={{...styles.button, ...styles.connectButton}}>Cerrar</button>
      </div>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState('Inactivo');
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [serverIp, setServerIp] = useState(window.location.hostname);
  const [serverPort, setServerPort] = useState('8765');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // --- ESTADO DE CONFIGURACIÓN AMPLIADO ---
  const [audioConfig, setAudioConfig] = useState({
    sampleRate: 48000,
    channels: 1,
    sampleWidthBytes: 2, // 2 bytes = Int16 (Default)
    framesPerBuffer: 128, // Default buffer size on server
  });

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [gain, setGain] = useState(1);
  const [logs, setLogs] = useState([]);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [analyserNode, setAnalyserNode] = useState(null);

  const webSocketRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const gainNodeRef = useRef(null);

  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prevLogs => [...prevLogs, { timestamp, message, type }]);
  }, []);

  const handleConfigChange = (e) => {
    const { name, value } = e.target;
    setAudioConfig(prev => ({...prev, [name]: parseInt(value, 10)}));
  };

  const connectToServer = () => {
    if (!serverIp || !serverPort) {
      addLog('IP y puerto requeridos.', 'error');
      setStatus('IP y puerto requeridos.');
      return;
    }
    const wsUrl = `wss://${serverIp}:${serverPort}`;
    addLog(`Conectando a ${wsUrl}...`);
    setStatus(`Conectando...`);

    webSocketRef.current = new WebSocket(wsUrl);

    webSocketRef.current.onopen = () => {
      addLog('Conexión establecida.');
      setStatus('Enviando configuración...');
      // El objeto audioConfig ahora contiene todos los parámetros
      const configPayload = { type: 'config', data: audioConfig };
      webSocketRef.current.send(JSON.stringify(configPayload));
      addLog(`Configuración enviada: ${JSON.stringify(configPayload.data)}`);
    };

    webSocketRef.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'devices') {
        addLog('Lista de altavoces recibida.');
        setStatus('Selecciona un altavoz y presiona Iniciar.');
        setDevices(message.data);
        if (message.data.length > 0) setSelectedDevice(message.data[0].index);
        setIsConnected(true);
      }
    };
    
    webSocketRef.current.onclose = () => { addLog('Conexión cerrada.', 'error'); resetState(); };
    webSocketRef.current.onerror = (error) => { addLog('Error de WebSocket.', 'error'); console.error(error); resetState(); };
  };

  const startAudioCapture = async () => {
    if (selectedDevice === '') {
      addLog('Selección de altavoz requerida.', 'error');
      setStatus('Debes seleccionar un altavoz.');
      return;
    }
    
    addLog(`Altavoz seleccionado: ${selectedDevice}.`);
    setStatus('Enviando selección...');
    webSocketRef.current.send(JSON.stringify({ type: 'select_device', data: selectedDevice }));
    
    try {
      addLog('Solicitando micrófono...');
      setStatus('Solicitando micrófono...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { channelCount: audioConfig.channels, sampleRate: audioConfig.sampleRate, echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
      });
      addLog('Micrófono activado.');
      
      const newAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: audioConfig.sampleRate });
      audioContextRef.current = newAudioContext;

      // --- GENERACIÓN DINÁMICA DEL WORKLET ---
      const processorCode = getAudioProcessorCode(audioConfig.sampleWidthBytes);
      const processorUrl = URL.createObjectURL(new Blob([processorCode], { type: 'application/javascript' }));
      await newAudioContext.audioWorklet.addModule(processorUrl);

      sourceRef.current = newAudioContext.createMediaStreamSource(stream);
      gainNodeRef.current = newAudioContext.createGain();
      const newAnalyserNode = newAudioContext.createAnalyser();
      const processorNode = new AudioWorkletNode(newAudioContext, 'audio-processor');
      
      newAnalyserNode.fftSize = 256;
      setAnalyserNode(newAnalyserNode);
      gainNodeRef.current.gain.value = gain;
      
      sourceRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(newAnalyserNode);
      newAnalyserNode.connect(processorNode);
      processorNode.connect(newAudioContext.destination);

      setIsRecording(true);
      setStatus('Transmitiendo...');
      addLog('Transmisión iniciada.');

      processorNode.port.onmessage = (event) => {
        if (webSocketRef.current?.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(event.data);
        }
      };

    } catch (error) {
      console.error('Error al iniciar captura:', error);
      addLog(`Error: ${error.message}`, 'error');
      setStatus('Error al acceder al micrófono.');
      resetState();
    }
  };

  const resetState = useCallback(() => {
    sourceRef.current?.mediaStream.getTracks().forEach(track => track.stop());
    webSocketRef.current?.close();
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    
    setIsConnected(false);
    setIsRecording(false);
    setDevices([]);
    setSelectedDevice('');
    setAnalyserNode(null);
    setStatus('Inactivo');
  }, []);

  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      gainNodeRef.current.gain.setValueAtTime(gain, audioContextRef.current.currentTime);
    }
  }, [gain]);
  
  useEffect(() => () => resetState(), [resetState]);

  // --- FUNCIÓN DE WORKLET DINÁMICA ---
  const getAudioProcessorCode = (sampleWidthBytes) => {
    let conversionLogic;
    let ArrayType;

    switch (sampleWidthBytes) {
      case 1: // Int8
        ArrayType = 'Int8Array';
        conversionLogic = 'buffer[i] = s < 0 ? Math.max(-1, s) * 128 : Math.min(1, s) * 127;';
        break;
      case 4: // Float32
        ArrayType = 'Float32Array';
        conversionLogic = 'buffer[i] = s;'; // Sin conversión, ya es Float32
        break;
      case 2: // Int16 (default)
      default:
        ArrayType = 'Int16Array';
        conversionLogic = 'buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;';
        break;
    }

    return `
      class AudioProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const channelData = inputs[0][0];
          if (!channelData) return true;
          
          const buffer = new ${ArrayType}(channelData.length);
          for (let i = 0; i < channelData.length; i++) {
            const s = channelData[i]; // Sample en Float32
            ${conversionLogic}
          }
          
          this.port.postMessage(buffer.buffer, [buffer.buffer]);
          return true;
        }
      }
      registerProcessor("audio-processor", AudioProcessor);
    `;
  };

  return (
    <div style={styles.container}>
      {isLogModalOpen && <LogModal logs={logs} onClose={() => setIsLogModalOpen(false)} />}
      <h1 style={styles.title}>Streaming de Audio en Tiempo Real</h1>
      
      {!isConnected ? (
        <>
          <div style={styles.inputGroup}><label style={styles.label} htmlFor="serverIp">IP del Servidor:</label><input style={styles.input} type="text" id="serverIp" value={serverIp} onChange={(e) => setServerIp(e.target.value)} /></div>
          <div style={styles.inputGroup}><label style={styles.label} htmlFor="serverPort">Puerto:</label><input style={styles.input} type="number" id="serverPort" value={serverPort} onChange={(e) => setServerPort(e.target.value)} /></div>
          <div style={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Ocultar' : 'Mostrar'} Parámetros Avanzados</div>
          {showAdvanced && (
            <div style={styles.advancedContainer}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Sample Rate (Hz):</label>
                <select name="sampleRate" value={audioConfig.sampleRate} onChange={handleConfigChange} style={styles.input}>
                  <option value="48000">48000</option><option value="44100">44100</option><option value="32000">32000</option><option value="16000">16000</option>
                </select>
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Canales:</label>
                <select name="channels" value={audioConfig.channels} onChange={handleConfigChange} style={styles.input}>
                  <option value="1">1 (Mono)</option><option value="2">2 (Stereo)</option>
                </select>
              </div>
              {/* --- NUEVO CAMPO: FORMATO DE MUESTRA --- */}
              <div style={styles.inputGroup}>
                <label style={styles.label}>Formato de Muestra:</label>
                <select name="sampleWidthBytes" value={audioConfig.sampleWidthBytes} onChange={handleConfigChange} style={styles.input}>
                  <option value="2">16-bit Integer (Estándar)</option>
                  <option value="1">8-bit Integer (Baja calidad)</option>
                  <option value="4">32-bit Float (Alta calidad)</option>
                </select>
              </div>
              {/* --- NUEVO CAMPO: TAMAÑO DE BÚFER --- */}
              <div style={styles.inputGroup}>
                <label style={styles.label}>Tamaño del Búfer (Servidor):</label>
                <select name="framesPerBuffer" value={audioConfig.framesPerBuffer} onChange={handleConfigChange} style={styles.input}>
                  <option value="128">128 (Latencia muy baja)</option>
                  <option value="256">256</option>
                  <option value="512">512 (Estándar)</option>
                  <option value="1024">1024</option>
                  <option value="2048">2048 (Latencia alta)</option>
                </select>
              </div>
            </div>
          )}
          <button onClick={connectToServer} style={{...styles.button, ...styles.connectButton, marginTop: '20px'}}>Conectar</button>
        </>
      ) : (
        <>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Selecciona un Altavoz de Salida:</label>
            <div style={styles.deviceButtonsContainer}>
              {devices.length > 0 ? (devices.map(device => (<button key={device.index} onClick={() => setSelectedDevice(device.index)} disabled={isRecording} style={{ ...styles.deviceButton, ...(selectedDevice === device.index ? styles.deviceButtonSelected : {}) }}>{`[${device.index}] - ${device.name}`}</button>))) : (<p style={styles.waitingText}>Esperando lista...</p>)}
            </div>
          </div>
          <div style={{ ...styles.inputGroup, marginTop: '1.5rem'}}>
            <label style={styles.label}>Nivel de Entrada (VU Meter):</label>
            <VUMeter analyserNode={analyserNode} />
          </div>
          <div style={styles.gainControl}>
            <label style={styles.label}>Ganancia: {Math.round(gain * 100)}%</label>
            <input style={styles.slider} type="range" id="gain" min="0" max="3" step="0.1" value={gain} onChange={(e) => setGain(e.target.value)} />
          </div>
          <div style={styles.buttonContainer}>
            {!isRecording ? (<button onClick={startAudioCapture} disabled={selectedDevice === ''} style={{...styles.button, ...styles.startButton}}>Iniciar Transmisión</button>) : (<button onClick={resetState} style={{...styles.button, ...styles.stopButton}}>Detener Transmisión</button>)}
          </div>
        </>
      )}
      <div style={styles.statusContainer}>
        <div style={{ ...styles.indicator, backgroundColor: isRecording ? '#4CAF50' : (isConnected ? '#FFC107' : '#f44336') }}></div>
        <p style={styles.statusText}>{status}</p>
        <button onClick={() => setIsLogModalOpen(true)} style={styles.logButton}>Ver Logs</button>
      </div>
    </div>
  );
}

// Estilos (sin cambios)
const styles = {
  container: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#121212', color: '#e0e0e0', fontFamily: 'Arial, sans-serif', padding: '20px' },
  title: { color: '#ffffff', marginBottom: '1.5rem', textAlign: 'center' },
  inputGroup: { marginBottom: '1rem', width: '100%', maxWidth: '500px' },
  label: { display: 'block', marginBottom: '10px', color: '#cccccc', textAlign: 'center', fontWeight: 'bold' },
  input: { width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #555', backgroundColor: '#2a2a2a', color: '#e0e0e0', boxSizing: 'border-box' },
  advancedToggle: { color: '#007bff', cursor: 'pointer', textAlign: 'center', margin: '15px 0', fontSize: '0.9em' },
  advancedContainer: { border: '1px solid #444', borderRadius: '5px', padding: '15px', marginTop: '10px', backgroundColor: '#1e1e1e' },
  deviceButtonsContainer: { display: 'flex', flexDirection: 'column', gap: '8px' },
  deviceButton: { padding: '12px 15px', border: '1px solid #555', borderRadius: '5px', backgroundColor: '#333333', color: '#e0e0e0', cursor: 'pointer', transition: 'all 0.2s ease-in-out', textAlign: 'center', width: '100%', whiteSpace: 'normal', minHeight: '48px', boxSizing: 'border-box' },
  deviceButtonSelected: { backgroundColor: '#007bff', color: 'white', borderColor: '#007bff', fontWeight: 'bold' },
  waitingText: { color: '#888888', fontStyle: 'italic', textAlign: 'center' },
  gainControl: { marginTop: '1.5rem', width: '100%', maxWidth: '500px' },
  slider: { width: '100%', cursor: 'pointer' },
  statusContainer: { display: 'flex', alignItems: 'center', marginTop: '2rem', width: '100%', maxWidth: '500px', justifyContent: 'center', position: 'relative' },
  indicator: { width: '15px', height: '15px', borderRadius: '50%', marginRight: '10px', flexShrink: 0 },
  statusText: { fontSize: '1.2rem', color: '#cccccc', margin: 0 },
  logButton: { position: 'absolute', right: 0, backgroundColor: 'transparent', border: '1px solid #555', color: '#ccc', padding: '5px 10px', borderRadius: '5px', cursor: 'pointer' },
  buttonContainer: { display: 'flex', gap: '1rem', marginTop: '20px' },
  button: { padding: '10px 20px', fontSize: '1rem', border: 'none', borderRadius: '5px', cursor: 'pointer', color: 'white', fontWeight: 'bold' },
  connectButton: { backgroundColor: '#007bff' },
  startButton: { backgroundColor: '#28a745' },
  stopButton: { backgroundColor: '#dc3545' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#2a2a2a', padding: '25px', borderRadius: '8px', width: '90%', maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: '1px solid #555' },
  logContainer: { flex: '1 1 auto', overflowY: 'auto', backgroundColor: '#121212', padding: '10px', borderRadius: '5px', marginBottom: '15px' },
  logEntry: { margin: '0 0 8px 0', borderBottom: '1px solid #333', paddingBottom: '5px', fontSize: '0.9em' }
};

export default App;
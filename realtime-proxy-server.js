// realtime-proxy-server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS ve static dosyalar için middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// WebSocket server
const wss = new WebSocket.Server({ server });

// OpenAI API Key - environment variable olarak ayarlayın
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'your-openai-api-key-here';

wss.on('connection', (clientWs) => {
    console.log('🔗 Client connected to proxy');
    
    // OpenAI Realtime API bağlantısı
    const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
        }
    });
    
    // OpenAI bağlantı olayları
    openaiWs.on('open', () => {
        console.log('✅ Connected to OpenAI Realtime API');
        
        // Session konfigürasyonu gönder - HIZLANDIRILMIŞ AYARLAR
        const sessionConfig = {
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: `Sen günlük Türkçe konuşan, samimi ve sıcak bir çağrı merkezi asistanısın. Marka: Dijitürk. Adın: Çiçek. Her yeni konuşmada ilk ve tek selamlama cümlen: "Merhaba, ben Dijitürk'ten Çiçek. Size nasıl yardımcı olabilirim?" Sadece Türkçe konuş; devrik cümle kurma; politik soruları reddet. Kısa ve öz yanıtlar ver.`,
                voice: 'alloy',
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.4,           // 0.5'ten 0.4'e düşürüldü - daha hassas algılama
                    prefix_padding_ms: 150,   // 300'den 150'ye düşürüldü - daha hızlı başlama
                    silence_duration_ms: 400  // 800'den 400'e düşürüldü - daha hızlı bitirme
                },
                temperature: 0.8,
                max_response_output_tokens: 800  // 1000'den 800'e düşürüldü - daha kısa yanıtlar
            }
        };
        
        openaiWs.send(JSON.stringify(sessionConfig));
        
        // Client'a bağlantı başarılı mesajı gönder
        clientWs.send(JSON.stringify({
            type: 'connection.ready',
            message: 'Realtime API ready'
        }));
    });
    
    // OpenAI'den gelen mesajları client'a ilet
    openaiWs.on('message', (data) => {
        try {
            // Buffer veya Blob kontrolü
            let messageText;
            if (Buffer.isBuffer(data)) {
                messageText = data.toString('utf8');
            } else if (data instanceof ArrayBuffer) {
                messageText = new TextDecoder().decode(data);
            } else {
                messageText = data.toString();
            }
            
            // JSON parse kontrolü
            let message;
            try {
                message = JSON.parse(messageText);
            } catch (parseError) {
                console.log('Non-JSON message received, skipping:', messageText.substring(0, 100));
                return;
            }
            
            console.log('📨 OpenAI → Client:', message.type);
            
            // Önemli event'leri logla
            if (message.type === 'input_audio_buffer.speech_started') {
                console.log('🎤 Speech started');
            } else if (message.type === 'input_audio_buffer.speech_stopped') {
                console.log('🔇 Speech stopped');
            } else if (message.type === 'response.audio_transcript.done') {
                console.log('💬 AI Response:', message.transcript);
            }
            
            // String olarak gönder
            clientWs.send(messageText);
        } catch (error) {
            console.error('Error processing OpenAI message:', error);
        }
    });
    
    // Client'dan gelen mesajları OpenAI'ye ilet
    clientWs.on('message', (data) => {
        try {
            // String'e çevir
            const messageText = data.toString();
            const message = JSON.parse(messageText);
            
            // Önemli event'leri logla
            if (message.type === 'input_audio_buffer.append') {
                console.log('🎵 Audio data received from client');
            } else {
                console.log('📨 Client → OpenAI:', message.type);
            }
            
            openaiWs.send(messageText);
        } catch (error) {
            console.error('Error processing client message:', error);
        }
    });
    
    // Hata yönetimi
    openaiWs.on('error', (error) => {
        console.error('❌ OpenAI WebSocket error:', error);
        clientWs.send(JSON.stringify({
            type: 'error',
            message: 'OpenAI connection error'
        }));
    });
    
    openaiWs.on('close', (code, reason) => {
        console.log('🔌 OpenAI connection closed:', code, reason ? reason.toString() : 'No reason');
        clientWs.send(JSON.stringify({
            type: 'connection.closed',
            message: 'OpenAI connection closed'
        }));
    });
    
    // Client bağlantısı kesildiğinde
    clientWs.on('close', () => {
        console.log('👋 Client disconnected');
        if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });
    
    clientWs.on('error', (error) => {
        console.error('❌ Client WebSocket error:', error);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Realtime Proxy Server is running',
        timestamp: new Date().toISOString()
    });
});

// Ana sayfa
app.get('/', (req, res) => {
    res.send(`
        <h1>🎤 OpenAI Realtime Proxy Server</h1>
        <p>Server is running on port ${PORT}</p>
        <p>WebSocket endpoint: ws://localhost:${PORT}</p>
        <p>Health check: <a href="/health">/health</a></p>
        <p>Place your HTML client in the 'public' folder</p>
    `);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Realtime Proxy Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready on ws://localhost:${PORT}`);
    console.log(`🎯 Make sure to set OPENAI_API_KEY environment variable`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down server...');
    server.close(() => {
        console.log('✅ Server shutdown complete');
        process.exit(0);
    });
});
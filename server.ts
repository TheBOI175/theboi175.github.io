import express from 'express';
import { WebSocketServer } from 'ws';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const execAsync = promisify(exec);
const PORT = parseInt(process.env.PORT || '8080');
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'default-secret-token';

interface Client {
  ws: any;
  lastPing: number;
  screenWidth: number;
  screenHeight: number;
}

let activeClient: Client | null = null;
let ffmpegProcess: any = null;

// Create Express app
const app = express();

// Health check page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>WebRTC Server</title></head>
    <body style="font-family: sans-serif; padding: 40px; background: #1a1a1a; color: #fff;">
      <h1>✅ WebRTC Remote Desktop Server</h1>
      <p>Status: <strong style="color: #4caf50;">Running</strong></p>
      <p>Connect via WebSocket to <code>/ws</code> with token parameter</p>
      <hr style="margin: 20px 0; border: 1px solid #333;">
      <h3>Connection Info:</h3>
      <p>Port: ${PORT}</p>
      <p>Active Client: ${activeClient ? 'Yes' : 'No'}</p>
    </body>
    </html>
  `);
});

// Serve the client HTML file
app.get('/client', (req, res) => {
  const clientPath = path.join(__dirname, 'client.html');
  if (fs.existsSync(clientPath)) {
    res.sendFile(clientPath);
  } else {
    res.status(404).send('Client file not found. Make sure client.html is in the same directory as server.ts');
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log('🚀 WebRTC Remote Desktop Server Started');
  console.log(`${'='.repeat(50)}`);
  console.log(`\n📡 Server URL: http://localhost:${PORT}`);
  console.log(`🔐 Auth Token: ${AUTH_TOKEN}`);
  console.log(`\n📝 Next Steps:`);
  console.log(`   1. In a new terminal, run:`);
  console.log(`      cloudflared tunnel --url http://localhost:${PORT}`);
  console.log(`   2. Copy the tunnel URL (e.g., https://xyz.trycloudflare.com)`);
  console.log(`   3. Open client.html and connect with:`);
  console.log(`      wss://xyz.trycloudflare.com/ws?token=${AUTH_TOKEN}`);
  console.log(`\n${'='.repeat(50)}\n`);
});

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// Get screen resolution
async function getScreenResolution(): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execAsync('system_profiler SPDisplaysDataType | grep Resolution');
    const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  } catch (err) {
    console.error('Failed to get screen resolution:', err);
  }
  return { width: 1920, height: 1080 }; // Default fallback
}

// Start screen capture stream
function startScreenCapture(ws: any) {
  if (ffmpegProcess) {
    ffmpegProcess.kill();
  }

  // Capture screen using FFmpeg and stream as JPEG frames
  ffmpegProcess = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-capture_cursor', '1',
    '-i', '0',  // Screen capture (device 0)
    '-r', '15',   // 15 fps (balance between quality and performance)
    '-vf', 'scale=1280:-1',  // Scale to 1280 width, maintain aspect ratio
    '-q:v', '5',  // JPEG quality (2-5 is good, lower = better quality)
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ]);

  let buffer = Buffer.alloc(0);

  ffmpegProcess.stdout.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);

    // Look for JPEG markers (FF D8 = start, FF D9 = end)
    let startIdx = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
    let endIdx = buffer.indexOf(Buffer.from([0xFF, 0xD9]));

    while (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const frame = buffer.slice(startIdx, endIdx + 2);
      
      // Send frame to client
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify({
          type: 'frame',
          data: frame.toString('base64')
        }));
      }

      // Remove processed frame from buffer
      buffer = buffer.slice(endIdx + 2);
      startIdx = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
      endIdx = buffer.indexOf(Buffer.from([0xFF, 0xD9]));
    }
  });

  ffmpegProcess.stderr.on('data', (data: Buffer) => {
    // Show FFmpeg output for debugging
    console.log('FFmpeg:', data.toString());
  });

  ffmpegProcess.on('close', (code: number) => {
    console.log('FFmpeg process exited with code:', code);
  });
}

// Execute input commands on Mac
async function executeInput(cmd: any) {
  try {
    switch (cmd.type) {
      case 'key':
        const keyAction = cmd.down ? 'key down' : 'key up';
        const key = cmd.key.toLowerCase();
        await execAsync(`osascript -e 'tell application "System Events" to ${keyAction} "${key}"'`);
        break;
      
      case 'mousemove':
        const x = Math.floor(cmd.x);
        const y = Math.floor(cmd.y);
        await execAsync(`cliclick m:${x},${y}`);
        break;
      
      case 'click':
        const cx = Math.floor(cmd.x);
        const cy = Math.floor(cmd.y);
        const button = cmd.button || 'left';
        await execAsync(`cliclick c:${cx},${cy}`);
        break;

      case 'scroll':
        const scrollAmount = cmd.deltaY > 0 ? -3 : 3; // Invert for natural scrolling
        await execAsync(`cliclick w:${scrollAmount}`);
        break;
    }
  } catch (err) {
    console.error('Input execution error:', err);
  }
}

// WebSocket connection handler
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  
  if (token !== AUTH_TOKEN) {
    console.log('❌ Connection rejected: Invalid token');
    ws.close(4001, 'Invalid token');
    return;
  }
  
  if (activeClient) {
    console.log('❌ Connection rejected: Client already connected');
    ws.close(4002, 'Client already connected');
    return;
  }
  
  console.log('✅ Client connected');
  
  const resolution = await getScreenResolution();
  
  activeClient = {
    ws,
    lastPing: Date.now(),
    screenWidth: resolution.width,
    screenHeight: resolution.height
  };

  // Send initial screen info
  ws.send(JSON.stringify({
    type: 'init',
    width: resolution.width,
    height: resolution.height
  }));

  // Start screen capture
  startScreenCapture(ws);
  
  // WebSocket message handling
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'input') {
        await executeInput(msg.data);
      } else if (msg.type === 'ping') {
        activeClient!.lastPing = Date.now();
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('❌ Client disconnected');
    if (ffmpegProcess) {
      ffmpegProcess.kill();
      ffmpegProcess = null;
    }
    activeClient = null;
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Heartbeat monitor
setInterval(() => {
  if (activeClient && Date.now() - activeClient.lastPing > 30000) {
    console.log('⏰ Client timeout, disconnecting');
    activeClient.ws.close();
    if (ffmpegProcess) {
      ffmpegProcess.kill();
      ffmpegProcess = null;
    }
    activeClient = null;
  }
}, 10000);

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  if (ffmpegProcess) {
    ffmpegProcess.kill();
  }
  process.exit(0);
});
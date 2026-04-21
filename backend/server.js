const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { SSHManager } = require('./services/sshManager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== 配置文件管理 ==================
const CONFIG_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 确保目录存在（递归创建）
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
}

const defaultConfig = {
  "connections": [],
  "groups": [ { "id": "1776693493484", "name": "默认分组" } ],
  "appSettings": {
    "theme": "auto",
    "language": "zh-CN",
    "fontSize": 14,
    "fontFamily": "Consolas",
    "backgroundColor": "#1e1e1e",
    "foregroundColor": "#d4d4d4",
    "defaultLocalPath": "",
    "concurrentUploads": 3,
    "confirmDelete": true
  },
  "sftp_col_widths": { "name": 300, "size": 100, "time": 160, "perm": 180 },
  "sftp_sort": { "field": "name", "order": "asc" },
  "sftp_overwrite_prefs": {},
  "sidebarWidth": 280,
  "expandedGroups": { "1776693493484": true }
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.log('✅ 创建默认配置文件:', CONFIG_FILE);
      return defaultConfig;
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    console.log('✅ 配置加载成功');
    return { ...defaultConfig, ...config };
  } catch (err) {
    console.error('❌ 加载配置文件失败:', err);
    return defaultConfig;
  }
}

function saveConfig(config) {
  try {
    // 再次确保目录存在（防止运行时被删除）
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('✅ 配置保存成功');
    return true;
  } catch (err) {
    console.error('❌ 保存配置文件失败:', err);
    return false;
  }
}

let appConfig = loadConfig();

app.get('/api/config', (req, res) => {
  res.json({ success: true, config: appConfig });
});

app.post('/api/config', (req, res) => {
  const { config } = req.body;
  if (!config) return res.status(400).json({ success: false, error: '缺少配置数据' });
  appConfig = { ...appConfig, ...config };
  if (saveConfig(appConfig)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: '保存配置文件失败，请检查目录权限' });
  }
});

app.post('/api/config/:key', (req, res) => {
  const { key } = req.params;
  const value = req.body.value;
  if (appConfig.hasOwnProperty(key)) {
    appConfig[key] = value;
    if (saveConfig(appConfig)) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: '保存配置文件失败' });
    }
  } else {
    res.status(400).json({ success: false, error: '无效的配置键' });
  }
});
// =================================================

// Multer 配置（支持中文文件名）
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    let originalName = file.originalname;
    try {
      originalName = Buffer.from(originalName, 'latin1').toString('utf8');
    } catch(e) {}
    const uniqueName = `${Date.now()}-${originalName}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

const sessions = new Map();
const sshManager = new SSHManager(sessions);

// 递归打包函数
async function addFolderToArchive(sessionId, remotePath, archive, archivePath) {
  const files = await sshManager.handleSFTPList(sessionId, remotePath);
  for (const item of files) {
    const itemRemotePath = remotePath === '/' ? `/${item.name}` : `${remotePath}/${item.name}`;
    const itemArchivePath = archivePath ? `${archivePath}/${item.name}` : item.name;
    if (item.type === 'directory') {
      archive.append(null, { name: itemArchivePath + '/' });
      await addFolderToArchive(sessionId, itemRemotePath, archive, itemArchivePath);
    } else {
      const stream = await sshManager.handleSFTPDownload(sessionId, itemRemotePath);
      archive.append(stream, { name: itemArchivePath });
    }
  }
}

// WebSocket 处理
wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');
  let currentSessionId = null;
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { type, sessionId, ...payload } = message;
      switch (type) {
        case 'ssh-connect':
          currentSessionId = sessionId || uuidv4();
          await sshManager.handleSSHConnect(ws, currentSessionId, payload);
          break;
        case 'ssh-data':
          if (sessionId && sessions.has(sessionId)) sshManager.handleSSHData(sessionId, payload.data);
          break;
        case 'ssh-resize':
          if (sessionId && sessions.has(sessionId)) sshManager.handleSSHResize(sessionId, payload.cols, payload.rows);
          break;
        case 'ssh-disconnect':
          if (sessionId && sessions.has(sessionId)) {
            sshManager.handleSSHDisconnect(sessionId);
            sessions.delete(sessionId);
          }
          break;
        case 'sftp-list':
          if (sessionId && sessions.has(sessionId)) {
            const files = await sshManager.handleSFTPList(sessionId, payload.path);
            ws.send(JSON.stringify({ type: 'sftp-list-response', sessionId, files, success: true }));
          } else {
            ws.send(JSON.stringify({ type: 'sftp-list-response', sessionId, success: false, error: '会话不存在' }));
          }
          break;
        case 'sftp-delete':
          if (sessionId && sessions.has(sessionId)) {
            const result = await sshManager.handleSFTPDelete(sessionId, payload.path);
            ws.send(JSON.stringify({ type: 'sftp-delete-response', sessionId, success: result }));
          }
          break;
        case 'sftp-mkdir':
          if (sessionId && sessions.has(sessionId)) {
            const result = await sshManager.handleSFTPMkdir(sessionId, payload.path);
            ws.send(JSON.stringify({ type: 'sftp-mkdir-response', sessionId, success: result }));
          }
          break;
        case 'sftp-rename':
          if (sessionId && sessions.has(sessionId)) {
            const result = await sshManager.handleSFTPRename(sessionId, payload.oldPath, payload.newPath);
            ws.send(JSON.stringify({ type: 'sftp-rename-response', sessionId, success: result }));
          }
          break;
        case 'sftp-chmod':
          if (sessionId && sessions.has(sessionId)) {
            const result = await sshManager.handleSFTPChmod(sessionId, payload.path, payload.mode);
            ws.send(JSON.stringify({ type: 'sftp-chmod-response', sessionId, success: result }));
          }
          break;
        default:
          console.log('Unknown message type:', type);
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (currentSessionId && sessions.has(currentSessionId)) {
      sshManager.handleSSHDisconnect(currentSessionId);
      sessions.delete(currentSessionId);
    }
  });
});

// HTTP API: 上传文件
app.post('/api/sftp/upload', upload.single('file'), async (req, res) => {
  const { sessionId, remotePath } = req.body;
  const file = req.file;
  if (!sessionId || !file || !remotePath) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });
  try {
    let originalName = file.originalname;
    try { originalName = Buffer.from(originalName, 'latin1').toString('utf8'); } catch(e) {}
    const remoteFilePath = path.join(remotePath, originalName).replace(/\\/g, '/');
    await sshManager.handleSFTPUpload(sessionId, file.path, remoteFilePath);
    fs.unlinkSync(file.path);
    res.json({ success: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// HTTP API: 下载文件
app.get('/api/sftp/download', async (req, res) => {
  const { sessionId, filePath } = req.query;
  if (!sessionId || !filePath) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });
  try {
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = await sshManager.handleSFTPDownload(sessionId, filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// HTTP API: 下载文件夹（打包为zip）
app.post('/api/sftp/download-folder', async (req, res) => {
  const { sessionId, folderPath } = req.body;
  if (!sessionId || !folderPath) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });

  const folderName = path.basename(folderPath);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(folderName + '.zip')}`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    else res.end();
  });
  archive.pipe(res);

  try {
    await addFolderToArchive(sessionId, folderPath, archive, folderName);
    await archive.finalize();
  } catch (err) {
    console.error('打包失败:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    else res.end();
  }
});

// HTTP API: 检查文件是否存在
app.post('/api/sftp/exists', async (req, res) => {
  const { sessionId, filePath } = req.body;
  if (!sessionId || !filePath) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });
  try {
    const exists = await sshManager.fileExists(sessionId, filePath);
    res.json({ success: true, exists });
  } catch (err) {
    console.error('检查文件失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 读取文件内容
app.post('/api/sftp/read-file', async (req, res) => {
  const { sessionId, filePath } = req.body;
  if (!sessionId || !filePath) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });
  try {
    const content = await sshManager.readFile(sessionId, filePath);
    res.json({ success: true, content });
  } catch (err) {
    console.error('读取文件失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 写入文件内容
app.post('/api/sftp/write-file', async (req, res) => {
  const { sessionId, filePath, content } = req.body;
  if (!sessionId || !filePath || content === undefined) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });
  try {
    await sshManager.writeFile(sessionId, filePath, content);
    res.json({ success: true });
  } catch (err) {
    console.error('写入文件失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建空文件
app.post('/api/sftp/create-file', async (req, res) => {
  const { sessionId, filePath } = req.body;
  if (!sessionId || !filePath) return res.status(400).json({ success: false, error: '缺少必要参数' });
  if (!sessions.has(sessionId)) return res.status(404).json({ success: false, error: '会话不存在' });
  try {
    await sshManager.createEmptyFile(sessionId, filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('创建文件失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 测试 SSH 连接
app.post('/api/ssh/test', async (req, res) => {
  const { host, port, username, password, privateKey } = req.body;
  const result = await sshManager.testConnection({ host, port, username, password, privateKey });
  res.json(result);
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
});
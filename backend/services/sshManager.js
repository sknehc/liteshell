const { Client } = require('ssh2');
const fs = require('fs');

class SSHManager {
  constructor(sessions) {
    this.sessions = sessions;
  }

  async handleSSHConnect(ws, sessionId, config) {
    const { host, port, username, password, privateKey, encoding = 'utf8' } = config;
    const conn = new Client();

    conn.on('ready', () => {
      console.log(`SSH连接成功: ${sessionId}`);
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, { sshClient: conn, sftp: null });
      } else {
        this.sessions.get(sessionId).sshClient = conn;
      }
      ws.send(JSON.stringify({ type: 'ssh-connected', sessionId, success: true }));

      // 默认终端参数（确保 cols/rows 为正整数）
      const cols = Math.max(80, config.cols || 120);
      const rows = Math.max(24, config.rows || 30);

      // 尝试创建 shell，如果失败则降级终端类型
      const createShell = (termType, callback) => {
        conn.shell({ term: termType, cols, rows }, callback);
      };

      createShell('xterm-256color', (err, stream) => {
        if (err) {
          console.warn(`xterm-256color 终端创建失败 (${sessionId}):`, err.message);
          // 尝试降级到 xterm
          createShell('xterm', (err2, stream2) => {
            if (err2) {
              console.warn(`xterm 终端创建失败 (${sessionId}):`, err2.message);
              // 最终降级到 vt100
              createShell('vt100', (err3, stream3) => {
                if (err3) {
                  console.error(`所有终端类型均失败 (${sessionId}):`, err3.message);
                  ws.send(JSON.stringify({ type: 'ssh-error', sessionId, error: `无法创建终端: ${err3.message}` }));
                  conn.end();
                  return;
                }
                setupStream(stream3);
              });
              return;
            }
            setupStream(stream2);
          });
          return;
        }
        setupStream(stream);
      });

      const setupStream = (stream) => {
        const session = this.sessions.get(sessionId);
        session.stream = stream;
        session.encoding = encoding; // 保存编码
        stream.on('data', (data) => {
          // 将 Buffer 按指定编码解码为字符串
          let decoded;
          try {
            decoded = iconv.decode(data, encoding);
          } catch(e) {
            decoded = data.toString('utf8'); // 降级
          }
          ws.send(JSON.stringify({ type: 'ssh-data', sessionId, data: decoded }));
        });
        stream.on('close', () => {
          ws.send(JSON.stringify({ type: 'ssh-disconnected', sessionId }));
          conn.end();
        });
        stream.on('error', (err) => {
          ws.send(JSON.stringify({ type: 'ssh-error', sessionId, error: err.message }));
        });
      };
    });

    conn.on('error', (err) => {
      console.error(`SSH连接错误 ${sessionId}:`, err);
      ws.send(JSON.stringify({ type: 'ssh-error', sessionId, error: err.message }));
    });

    const connectConfig = {
      host: host,
      port: port || 22,
      username: username,
      readyTimeout: 30000,
    };
    if (password) {
      connectConfig.password = password;
    } else if (privateKey) {
      connectConfig.privateKey = privateKey;
    }
    conn.connect(connectConfig);
  }

  handleSSHData(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      const encoding = session.encoding || 'utf8';
      let buffer;
      try {
        buffer = iconv.encode(data, encoding);
      } catch(e) {
        buffer = Buffer.from(data, 'utf8');
      }
      session.stream.write(buffer);
    }
  }

  handleSSHResize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      session.stream.setWindow(rows, cols, 0, 0);
    }
  }

  handleSSHDisconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.stream) session.stream.end();
      if (session.sshClient) session.sshClient.end();
      if (session.sftp) session.sftp.end();
    }
  }

  // 获取或建立 SFTP 通道（复用）
  async getSFTP(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sshClient) {
      throw new Error('SSH会话不存在');
    }
    if (session.sftp) {
      return session.sftp;
    }
    // 尝试新建 SFTP 通道
    return new Promise((resolve, reject) => {
      session.sshClient.sftp((err, sftp) => {
        if (err) {
          reject(err);
        } else {
          session.sftp = sftp;
          resolve(sftp);
        }
      });
    });
  }

  async handleSFTPList(sessionId, path) {
    try {
      const sftp = await this.getSFTP(sessionId);
      return new Promise((resolve, reject) => {
        const targetPath = path || '/';
        sftp.readdir(targetPath, (err, list) => {
          if (err) {
            reject(err);
            return;
          }
          const files = list.map(item => ({
            name: item.filename,
            type: item.attrs.isDirectory() ? 'directory' : 'file',
            size: item.attrs.size,
            modifyTime: item.attrs.mtime * 1000,
            permissions: item.attrs.mode.toString(8)
          }));
          resolve(files);
        });
      });
    } catch (err) {
      // 捕获通道打开失败的错误，转换为更友好的提示
      if (err.message === 'No response from server' || err.message.includes('Channel open failure')) {
        throw new Error('无法打开 SFTP 通道，可能是服务器限制了并发会话数（MaxSessions=1）。请尝试修改 SSH 服务器配置或使用单独的连接。');
      }
      throw err;
    }
  }

  async handleSFTPDelete(sessionId, path) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      sftp.stat(path, (err, stats) => {
        if (err) {
          reject(err);
          return;
        }
        if (stats.isDirectory()) {
          this._deleteDirectory(sftp, path, (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        } else {
          sftp.unlink(path, (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        }
      });
    });
  }

  _deleteDirectory(sftp, dirPath, callback) {
    sftp.readdir(dirPath, (err, list) => {
      if (err) {
        callback(err);
        return;
      }
      let pending = list.length;
      if (pending === 0) {
        sftp.rmdir(dirPath, callback);
        return;
      }
      let errorOccurred = false;
      list.forEach((item) => {
        const itemPath = dirPath === '/' ? `/${item.filename}` : `${dirPath}/${item.filename}`;
        if (item.attrs.isDirectory()) {
          this._deleteDirectory(sftp, itemPath, (err) => {
            if (err && !errorOccurred) {
              errorOccurred = true;
              callback(err);
              return;
            }
            if (--pending === 0 && !errorOccurred) {
              sftp.rmdir(dirPath, callback);
            }
          });
        } else {
          sftp.unlink(itemPath, (err) => {
            if (err && !errorOccurred) {
              errorOccurred = true;
              callback(err);
              return;
            }
            if (--pending === 0 && !errorOccurred) {
              sftp.rmdir(dirPath, callback);
            }
          });
        }
      });
    });
  }

  async handleSFTPMkdir(sessionId, path) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      sftp.mkdir(path, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }

  async handleSFTPRename(sessionId, oldPath, newPath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }

  async handleSFTPChmod(sessionId, path, mode) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      const modeInt = parseInt(mode, 8);
      sftp.chmod(path, modeInt, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }

  async handleSFTPUpload(sessionId, localPath, remotePath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);
      writeStream.on('close', () => resolve(true));
      writeStream.on('error', reject);
      readStream.pipe(writeStream);
    });
  }

  async handleSFTPDownload(sessionId, remotePath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      const readStream = sftp.createReadStream(remotePath);
      readStream.on('error', reject);
      resolve(readStream);
    });
  }

  async readFile(sessionId, remotePath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      let data = '';
      const readStream = sftp.createReadStream(remotePath);
      readStream.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      readStream.on('error', reject);
      readStream.on('end', () => {
        resolve(data);
      });
    });
  }

  async writeFile(sessionId, remotePath, content) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      const writeStream = sftp.createWriteStream(remotePath);
      writeStream.on('error', reject);
      writeStream.on('close', () => resolve(true));
      writeStream.write(content, 'utf8');
      writeStream.end();
    });
  }

  async fileExists(sessionId, remotePath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          if (err.code === 2) resolve(false);
          else reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  async createEmptyFile(sessionId, remotePath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      const writeStream = sftp.createWriteStream(remotePath);
      writeStream.on('error', reject);
      writeStream.on('close', () => resolve(true));
      writeStream.end();
    });
  }

  async testConnection(config) {
    return new Promise((resolve) => {
      const conn = new Client();
      const { host, port, username, password, privateKey } = config;
      const connectConfig = {
        host: host,
        port: port || 22,
        username: username,
        readyTimeout: 10000,
      };
      if (password) {
        connectConfig.password = password;
      } else if (privateKey) {
        connectConfig.privateKey = privateKey;
      }
      const timer = setTimeout(() => {
        conn.end();
        resolve({ success: false, error: '连接超时' });
      }, 10000);
      conn.on('ready', () => {
        clearTimeout(timer);
        conn.end();
        resolve({ success: true });
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });
      conn.connect(connectConfig);
    });
  }
}

module.exports = { SSHManager };
const { Client } = require('ssh2');
const fs = require('fs');

class SSHManager {
  constructor(sessions) {
    this.sessions = sessions;
  }

  async handleSSHConnect(ws, sessionId, config) {
    const { host, port, username, password, privateKey } = config;
    const conn = new Client();
    
    conn.on('ready', () => {
      console.log(`SSH连接成功: ${sessionId}`);
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, { sshClient: conn, sftp: null });
      } else {
        this.sessions.get(sessionId).sshClient = conn;
      }
      ws.send(JSON.stringify({ type: 'ssh-connected', sessionId, success: true }));
      
      conn.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'ssh-error', sessionId, error: err.message }));
          return;
        }
        const session = this.sessions.get(sessionId);
        session.stream = stream;
        stream.on('data', (data) => {
          ws.send(JSON.stringify({ type: 'ssh-data', sessionId, data: data.toString('binary') }));
        });
        stream.on('close', () => {
          ws.send(JSON.stringify({ type: 'ssh-disconnected', sessionId }));
          conn.end();
        });
        stream.on('error', (err) => {
          ws.send(JSON.stringify({ type: 'ssh-error', sessionId, error: err.message }));
        });
      });
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
      session.stream.write(Buffer.from(data, 'binary'));
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
  
  async handleSFTPList(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sshClient) {
        reject(new Error('SSH会话不存在'));
        return;
      }
      session.sshClient.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        session.sftp = sftp;
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
    });
  }

  async handleSFTPDelete(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sftp) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      const sftp = session.sftp;
      // 先判断是文件还是目录
      sftp.stat(path, (err, stats) => {
        if (err) {
          reject(err);
          return;
        }
        if (stats.isDirectory()) {
          // 递归删除目录
          this._deleteDirectory(sftp, path, (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        } else {
          // 删除文件
          sftp.unlink(path, (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        }
      });
    });
  }

  // 递归删除目录（私有方法）
  _deleteDirectory(sftp, dirPath, callback) {
    sftp.readdir(dirPath, (err, list) => {
      if (err) {
        callback(err);
        return;
      }
      let pending = list.length;
      if (pending === 0) {
        // 空目录，直接删除
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
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sftp) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      session.sftp.mkdir(path, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }
  
  async handleSFTPRename(sessionId, oldPath, newPath) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sftp) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      session.sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }
  
  async handleSFTPChmod(sessionId, path, mode) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sftp) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      const modeInt = parseInt(mode, 8);
      session.sftp.chmod(path, modeInt, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }
  
  async handleSFTPUpload(sessionId, localPath, remotePath) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sftp) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      const readStream = fs.createReadStream(localPath);
      const writeStream = session.sftp.createWriteStream(remotePath);
      writeStream.on('close', () => resolve(true));
      writeStream.on('error', reject);
      readStream.pipe(writeStream);
    });
  }
  
  async handleSFTPDownload(sessionId, remotePath) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.sftp) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      const readStream = session.sftp.createReadStream(remotePath);
      readStream.on('error', reject);
      resolve(readStream);
    });
  }
  async readFile(sessionId, remotePath) {
  return new Promise((resolve, reject) => {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) {
      reject(new Error('SFTP会话不存在'));
      return;
    }
    let data = '';
    const readStream = session.sftp.createReadStream(remotePath);
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
  return new Promise((resolve, reject) => {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) {
      reject(new Error('SFTP会话不存在'));
      return;
    }
    const writeStream = session.sftp.createWriteStream(remotePath);
    writeStream.on('error', reject);
    writeStream.on('close', () => resolve(true));
    writeStream.write(content, 'utf8');
    writeStream.end();
  });
}
async fileExists(sessionId, remotePath) {
  return new Promise((resolve, reject) => {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) {
      reject(new Error('SFTP会话不存在'));
      return;
    }
    session.sftp.stat(remotePath, (err, stats) => {
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
  return new Promise((resolve, reject) => {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) {
      reject(new Error('SFTP会话不存在'));
      return;
    }
    // 创建空文件（写入空字符串）
    const writeStream = session.sftp.createWriteStream(remotePath);
    writeStream.on('error', reject);
    writeStream.on('close', () => resolve(true));
    writeStream.end(); // 写入空内容，即创建空文件
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
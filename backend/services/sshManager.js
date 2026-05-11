const { Client } = require('ssh2');
const fs = require('fs');
const iconv = require('iconv-lite');  // 添加这一行

class SSHManager {
  constructor(sessions) {
    this.sessions = sessions;
  }

  async handleSSHConnect(ws, sessionId, config) {
    const { host, port, username, password, privateKey, encoding = 'utf8' } = config;
    const conn = new Client();
    conn.on('ready', () => {
      console.log(`SSH连接成功: ${sessionId}`);
      // 先初始化 sessions 条目（确保存在）
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = { sshClient: conn, sftp: null };
        this.sessions.set(sessionId, session);
      } else {
        session.sshClient = conn;
      }

      // 获取 umask 并存入 session
      conn.exec('umask', (err, stream) => {
        if (!err) {
          let output = '';
          stream.on('data', (data) => { output += data.toString(); });
          stream.on('close', () => {
            const umaskVal = parseInt(output.trim(), 8);
            if (!isNaN(umaskVal)) {
              session.umask = umaskVal;
              console.log(`获取到 umask: ${umaskVal.toString(8)} for session ${sessionId}`);
            } else {
              console.log(`无法解析 umask 输出: "${output}"`);
            }
          });
        } else {
          console.warn(`获取 umask 失败: ${err.message}`);
        }
      });

      ws.send(JSON.stringify({ type: 'ssh-connected', sessionId, success: true }));

      const cols = Math.max(80, config.cols || 120);
      const rows = Math.max(24, config.rows || 30);

      const createShell = (termType, callback) => {
        conn.shell({ term: termType, cols, rows }, callback);
      };

      createShell('xterm-256color', (err, stream) => {
        if (err) {
          console.warn(`xterm-256color 终端创建失败 (${sessionId}):`, err.message);
          createShell('xterm', (err2, stream2) => {
            if (err2) {
              console.warn(`xterm 终端创建失败 (${sessionId}):`, err2.message);
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
        session.encoding = encoding;
        stream.on('data', (data) => {
          let decoded;
          try {
            decoded = iconv.decode(data, encoding);
          } catch(e) {
            decoded = data.toString('utf8');
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

  async getSFTP(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sshClient) {
      throw new Error('SSH会话不存在');
    }
    if (session.sftp) {
      return session.sftp;
    }
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

  async getSFTPPwd(sessionId) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      sftp.realpath('.', (err, absPath) => {
        if (err) reject(err);
        else resolve(absPath);
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

  async handleSFTPMkdir(sessionId, path, mode = null) {
    const sftp = await this.getSFTP(sessionId);
    const session = this.sessions.get(sessionId);
    return new Promise((resolve, reject) => {
      let targetMode = mode;
      if (targetMode === null) {
        targetMode = 0o755; // 默认
        if (session && typeof session.umask === 'number') {
          targetMode = 0o777 & (~session.umask & 0o777);
        }
      }
      sftp.mkdir(path, { mode: targetMode }, (err) => {
        if (err) {
          if (err.code === 4) {
            // 目录已存在，检查是否为目录
            sftp.stat(path, (statErr, stats) => {
              if (!statErr && stats.isDirectory()) resolve(true);
              else reject(new Error(`无法创建目录: ${statErr ? statErr.message : '路径已存在但不是目录或无法访问'}`));
            });
          } else {
            reject(err);
          }
        } else {
          resolve(true);
        }
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

  async handleSFTPUpload(sessionId, localPath, remotePath, mode = null) {
    const sftp = await this.getSFTP(sessionId);
    const session = this.sessions.get(sessionId);
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(localPath);
      let writeStream;

      if (mode === null) {
        // 新建文件：根据 umask 计算权限并在创建流时直接指定
        let targetMode = 0o644; // 默认后备
        if (session && typeof session.umask === 'number') {
          // 计算 666 & ~umask
          targetMode = 0o666 & (~session.umask & 0o777);
          console.log(`umask: ${session.umask.toString(8)}, 计算目标权限: ${targetMode.toString(8)}`);
        } else {
          console.log(`未获取到 umask，使用默认权限 644`);
        }
        console.log(`创建文件并直接设置权限: ${targetMode.toString(8)} for ${remotePath}`);
        writeStream = sftp.createWriteStream(remotePath, { mode: targetMode });
      } else {
        // 覆盖文件：先正常创建流，之后再恢复原权限
        writeStream = sftp.createWriteStream(remotePath);
      }

      let finished = false;
      writeStream.on('close', () => {
        if (finished) return;
        finished = true;
        if (mode !== null) {
          // 覆盖文件：恢复原权限
          sftp.chmod(remotePath, mode, (err) => {
            if (err) {
              console.error(`chmod 失败 (覆盖) ${remotePath}:`, err);
              reject(err);
            } else {
              console.log(`覆盖文件权限已恢复: ${mode.toString(8)}`);
              resolve(true);
            }
          });
        } else {
          // 新建文件权限已在 createWriteStream 时设置，无需额外 chmod
          resolve(true);
        }
      });
      writeStream.on('error', (err) => {
        if (finished) return;
        finished = true;
        reject(err);
      });
      readStream.pipe(writeStream);
    });
  }
  async getFileMode(sessionId, remotePath) {
    const sftp = await this.getSFTP(sessionId);
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) reject(err);
        else resolve(stats.mode & 0o777);
      });
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

  async createEmptyFile(sessionId, remotePath, mode = null) {
    const sftp = await this.getSFTP(sessionId);
    const session = this.sessions.get(sessionId);
    return new Promise((resolve, reject) => {
      let targetMode = mode;
      if (targetMode === null) {
        // 新建文件：根据 umask 计算权限，默认为 0o644
        targetMode = 0o644;
        if (session && typeof session.umask === 'number') {
          targetMode = 0o666 & (~session.umask & 0o777);
        }
      }
      const writeStream = sftp.createWriteStream(remotePath, { mode: targetMode });
      writeStream.on('error', reject);
      writeStream.on('close', () => resolve(true));
      writeStream.end();
    });
  }

  async getSystemStats(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sshClient) {
      throw new Error('SSH会话不存在');
    }

    return new Promise((resolve) => {
      // 注意：使用数组拼接避免模板字符串内的反斜杠转义问题
      const command = [
        'cpu=$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk \'{print $2}\' | cut -d\'%\' -f1);',
        'if [ -z "$cpu" ]; then',
        '  cpu=$(top -bn1 2>/dev/null | grep "%Cpu" | awk \'{print $2}\' | cut -d\'%\' -f1);',
        'fi;',
        'mem=$(free -m 2>/dev/null | awk \'NR==2{printf "%.1f", $3*100/$2}\');',
        'echo "CPU:${cpu:-0}% MEM:${mem:-0}%"'
      ].join(' ');

      session.sshClient.exec(command, (err, stream) => {
        if (err) {
          console.error(`获取系统状态失败 ${sessionId}:`, err);
          resolve({ cpu: 0, mem: 0 });
          return;
        }

        let output = '';
        stream.on('data', (data) => {
          output += data.toString();
        });
        stream.on('close', () => {
          const cpuMatch = output.match(/CPU:([\d.]+)%/);
          const memMatch = output.match(/MEM:([\d.]+)%/);
          resolve({
            cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
            mem: memMatch ? parseFloat(memMatch[1]) : 0
          });
        });
        stream.on('error', () => {
          resolve({ cpu: 0, mem: 0 });
        });
      });
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
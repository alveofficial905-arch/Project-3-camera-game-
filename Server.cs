using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;

namespace TempleServer {
    public class HttpServer {
        private readonly int _port;
        private readonly string _rootDir;
        private TcpListener _listener;
        private bool _isRunning;

        private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { ".html", "text/html; charset=utf-8" },
            { ".htm",  "text/html; charset=utf-8" },
            { ".css",  "text/css; charset=utf-8" },
            { ".js",   "application/javascript; charset=utf-8" },
            { ".json", "application/json" },
            { ".png",  "image/png" },
            { ".jpg",  "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".gif",  "image/gif" },
            { ".svg",  "image/svg+xml" },
            { ".ico",  "image/x-icon" },
            { ".wasm", "application/wasm" },
            { ".mp3",  "audio/mpeg" },
            { ".wav",  "audio/wav" }
        };

        public HttpServer(int port, string rootDir) {
            _port = port;
            _rootDir = Path.GetFullPath(rootDir);
        }

        public void Start() {
            _isRunning = true;
            _listener = new TcpListener(IPAddress.Any, _port);
            _listener.Start(100);

            Console.WriteLine("==========================================================");
            Console.WriteLine("  TEMPLE RUN IRL - MULTI-THREADED SERVER RUNNING");
            Console.WriteLine("  Port: " + _port);
            Console.WriteLine("  Root: " + _rootDir);
            Console.WriteLine("==========================================================");

            while (_isRunning) {
                try {
                    TcpClient client = _listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(new WaitCallback(HandleClient), client);
                } catch (Exception ex) {
                    if (!_isRunning) break;
                    Console.WriteLine("Listener exception: " + ex.Message);
                }
            }
        }

        public void Stop() {
            _isRunning = false;
            if (_listener != null) {
                try {
                    _listener.Stop();
                } catch { }
            }
        }

        private void HandleClient(object state) {
            TcpClient client = (TcpClient)state;
            using (client) {
                try {
                    client.ReceiveTimeout = 3000;
                    client.SendTimeout = 3000;

                    using (NetworkStream stream = client.GetStream()) {
                        byte[] buffer = new byte[8192];
                        int bytesRead = stream.Read(buffer, 0, buffer.Length);
                        if (bytesRead <= 0) return;

                        string reqText = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                        int firstLineEnd = reqText.IndexOfAny(new char[] { '\r', '\n' });
                        if (firstLineEnd <= 0) return;

                        string reqLine = reqText.Substring(0, firstLineEnd).Trim();
                        string[] parts = reqLine.Split(' ');
                        if (parts.Length < 2) return;

                        string rawUrl = parts[1];
                        int qIdx = rawUrl.IndexOf('?');
                        if (qIdx >= 0) rawUrl = rawUrl.Substring(0, qIdx);

                        string decodedPath = Uri.UnescapeDataString(rawUrl).TrimStart('/');
                        if (string.IsNullOrEmpty(decodedPath)) decodedPath = "index.html";

                        string fullPath = Path.GetFullPath(Path.Combine(_rootDir, decodedPath.Replace('/', Path.DirectorySeparatorChar)));

                        // Security check: must remain inside rootDir
                        if (!fullPath.StartsWith(_rootDir, StringComparison.OrdinalIgnoreCase)) {
                            Send403(stream);
                            return;
                        }

                        if (File.Exists(fullPath)) {
                            string ext = Path.GetExtension(fullPath);
                            string mime;
                            if (!MimeTypes.TryGetValue(ext, out mime)) {
                                mime = "application/octet-stream";
                            }

                            byte[] fileBytes = File.ReadAllBytes(fullPath);
                            string header = "HTTP/1.1 200 OK\r\n" +
                                           "Content-Type: " + mime + "\r\n" +
                                           "Content-Length: " + fileBytes.Length + "\r\n" +
                                           "Access-Control-Allow-Origin: *\r\n" +
                                           "Cache-Control: no-cache, no-store, must-revalidate\r\n" +
                                           "Connection: close\r\n\r\n";
                            byte[] headerBytes = Encoding.ASCII.GetBytes(header);

                            stream.Write(headerBytes, 0, headerBytes.Length);
                            stream.Write(fileBytes, 0, fileBytes.Length);
                            stream.Flush();
                        } else {
                            Send404(stream, decodedPath);
                        }
                    }
                } catch {
                    // Suppress per-request connection aborts
                }
            }
        }

        private void Send404(NetworkStream stream, string path) {
            byte[] body = Encoding.UTF8.GetBytes("404 Not Found: " + path);
            string header = "HTTP/1.1 404 Not Found\r\n" +
                           "Content-Type: text/plain\r\n" +
                           "Content-Length: " + body.Length + "\r\n" +
                           "Access-Control-Allow-Origin: *\r\n" +
                           "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        private void Send403(NetworkStream stream) {
            byte[] body = Encoding.UTF8.GetBytes("403 Forbidden");
            string header = "HTTP/1.1 403 Forbidden\r\n" +
                           "Content-Type: text/plain\r\n" +
                           "Content-Length: " + body.Length + "\r\n" +
                           "Access-Control-Allow-Origin: *\r\n" +
                           "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(body, 0, body.Length);
            stream.Flush();
        }
    }
}

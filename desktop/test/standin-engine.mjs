// Stand-in for the Go engine, used by the smoke test. Serves one HTML line and
// prints the contract's WILDCALL_LISTENING line. Exits when stdin hits EOF
// (like -parent-stdin). STANDIN_MODE=die exits immediately with output.
import http from 'node:http';

if (process.env.STANDIN_MODE === 'die') {
  console.log('stand-in: about to fail');
  console.error('stand-in: fatal: boom');
  process.exit(3);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>stand-in</title><body>WILDCALL STAND-IN</body>');
});
server.listen(0, '127.0.0.1', () => {
  console.log('some startup noise');
  console.log(`WILDCALL_LISTENING http://127.0.0.1:${server.address().port}`);
});
process.stdin.resume();
process.stdin.on('end', () => {
  server.close();
  process.exit(0);
});

const net = require('net');

const PREFERRED_POS_PORT = 57590;

function probePort(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(port, host, () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function findAvailablePort(preferredPort = PREFERRED_POS_PORT) {
  try {
    return await probePort(preferredPort);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    return probePort(0);
  }
}

module.exports = { PREFERRED_POS_PORT, findAvailablePort, probePort };

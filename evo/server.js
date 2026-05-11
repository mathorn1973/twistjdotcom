const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

let globalTick = 0;
const TICK_RATE = 1000 / 60; // 60 Hz = 16.66 ms
const NETWORK_BUFFER_TICKS = 8; // 8 ticks = ~133 ms

// Fronta VŠECH příchozích událostí od VŠECH klientů
let pendingEvents = [];

// Scheduled settings changes (applied at a future tick, like drag events)
let pendingSettings = null; // only latest matters (overwrites previous)

// FIFO client tracking — first connected = master
let clientOrder = [];
let clientId = 0;

// --- Auto-sync: hash-based desync detection ---
let hashStore = {};          // clientId → { tick, ph, fh, blocks, ts }
let lastAutoSync = 0;
const AUTO_SYNC_COOLDOWN = 150000; // ms — don't auto-sync more than once per 2.5min

// --- Adaptive heartbeat ---
let heartbeatInterval = 5;          // start aggressive: every 5 ticks (~83ms)
const HEARTBEAT_CONVERGED = 30;     // after calibration: every 30 ticks (~500ms)
const CALIBRATION_TICKS = 360;      // ~6s at 60Hz — enough for EMA to settle
let lastDataTick = 0;               // tick when we last sent net_bundle or settings_at

function checkHashes() {
    if (clientOrder.length < 2) return;
    const now = Date.now();
    if (now - lastAutoSync < AUTO_SYNC_COOLDOWN) return;

    const masterId = clientOrder[0]._clientId;
    const masterH = hashStore[masterId];
    if (!masterH) return;

    for (let i = 1; i < clientOrder.length; i++) {
        const slaveId = clientOrder[i]._clientId;
        const slaveH = hashStore[slaveId];
        if (!slaveH) continue;

        // Only compare if ticks are close (within 8 ticks = ~133ms)
        if (Math.abs(masterH.tick - slaveH.tick) > 8) continue;

        // --- Block-level hash comparison (preferred) ---
        if (masterH.blocks && slaveH.blocks) {
            // Decode block hashes
            const mBlocks = new Uint32Array(
                Uint8Array.from(Buffer.from(masterH.blocks, 'base64')).buffer
            );
            const sBlocks = new Uint32Array(
                Uint8Array.from(Buffer.from(slaveH.blocks, 'base64')).buffer
            );

            // Find divergent blocks
            const dirty = [];
            for (let b = 0; b < mBlocks.length; b++) {
                if (mBlocks[b] !== sBlocks[b]) dirty.push(b);
            }

            if (dirty.length === 0) continue; // particle hash mismatch but field is fine

            console.log(`DESYNC: ${dirty.length}/256 field blocks differ. ` +
                `Master #${masterId} vs Slave #${slaveId}`);

            // Request only dirty blocks from master
            const master = clientOrder[0];
            if (master.readyState === WebSocket.OPEN) {
                master.send(JSON.stringify({
                    type: 'request_field_blocks',
                    blocks: dirty
                }));
            }

            lastAutoSync = now;
            return;
        }

        // --- Fallback: full field snapshot (when block hashes not available) ---
        if (masterH.ph !== slaveH.ph || masterH.fh !== slaveH.fh) {
            console.log(`DESYNC detected (no block hashes)! Master #${masterId} vs Slave #${slaveId}`);

            const master = clientOrder[0];
            if (master.readyState === WebSocket.OPEN) {
                master.send(JSON.stringify({ type: 'request_field' }));
                console.log('Requested field snapshot from master for soft sync.');
            }

            lastAutoSync = now;
            return;
        }
    }
}

function broadcastRole() {
    clientOrder.forEach((ws, i) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'role',
                role: i === 0 ? 'master' : 'slave',
                clients: clientOrder.length
            }));
        }
    });
}

wss.on('connection', (ws) => {
    ws._clientId = ++clientId;
    clientOrder.push(ws);
    console.log(`Client #${ws._clientId} connected. Total: ${clientOrder.length}. Master: #${clientOrder[0]._clientId}`);

    // 1. Synchronizace času při připojení
    ws.send(JSON.stringify({ type: 'sync', tick: globalTick }));

    // 2. Broadcast roles to everyone (new client = slave, existing master stays)
    broadcastRole();

    // 3. Force full re-sync: reset everyone so late joiners start from same state
    if (clientOrder.length > 1) {
        globalTick = 0;
        pendingEvents = [];
        pendingSettings = null;
        hashStore = {};
        const resetBundle = JSON.stringify({ type: 'action', action: 'resync' });
        clientOrder.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(resetBundle);
        });
        console.log(`New client joined — full resync triggered. All clients reset to tick 0.`);
    }

    // 3. Příjem událostí
    ws.on('message', (msg) => {
        try {
            let data = JSON.parse(msg);
            if (data.type === 'drag') {
                pendingEvents.push({ x: data.x, y: data.y, s: data.s });
            } else if (data.type === 'settings') {
                // Immediate settings broadcast (used after reset/resync/sync actions).
                // Echoed to ALL clients including sender for livePhys sync.
                if (clientOrder[0] === ws) {
                    const bundle = JSON.stringify({
                        type: 'settings',
                        values: data.values
                    });
                    clientOrder.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(bundle);
                        }
                    });
                }
            } else if (data.type === 'settings_change') {
                // Scheduled settings change (slider/toggle moved by master).
                // Goes through the tick scheduler so ALL clients apply at the same tick.
                if (clientOrder[0] === ws) {
                    pendingSettings = data.values; // latest wins (overwrites previous)
                }
            } else if (data.type === 'hash') {
                // Desync detection: store client's hash (with optional block hashes)
                hashStore[ws._clientId] = {
                    tick: data.tick,
                    ph: data.ph,
                    fh: data.fh,
                    blocks: data.blocks || null,
                    ts: Date.now()
                };
                checkHashes();
            } else if (data.type === 'rejoin') {
                // Client returning from background tab — trigger full resync for all clients.
                globalTick = 0;
                pendingEvents = [];
                pendingSettings = null;
                hashStore = {};
                const syncBundle = JSON.stringify({ type: 'action', action: 'sync' });
                clientOrder.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) client.send(syncBundle);
                });
                console.log(`Client #${ws._clientId} rejoined from background — full resync triggered.`);
            } else if (data.type === 'action') {
                // Only master can broadcast actions
                if (clientOrder[0] === ws) {
                    if (data.action === 'reset' || data.action === 'defaults' || data.action === 'sync') {
                        globalTick = 0;
                        pendingEvents = [];
                        pendingSettings = null;
                        hashStore = {};
                    }

                    const bundle = JSON.stringify({
                        type: 'action',
                        action: data.action
                    });
                    clientOrder.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(bundle);
                        }
                    });
                    console.log(`Master #${ws._clientId} triggered action: ${data.action}`);
                }
            } else if (data.type === 'field_snapshot') {
                // Master sends full field data. Relay to all slaves (soft sync).
                if (clientOrder[0] === ws) {
                    const bundle = JSON.stringify({
                        type: 'soft_sync',
                        field: data.field,       // base64 encoded field texture
                        tick: data.tick,
                        flip: data.flip
                    });
                    clientOrder.forEach((client, idx) => {
                        if (idx > 0 && client.readyState === WebSocket.OPEN) {
                            client.send(bundle);
                        }
                    });
                    hashStore = {};
                    console.log(`Field snapshot relayed to ${clientOrder.length - 1} slave(s). Soft sync.`);
                }
            } else if (data.type === 'field_blocks') {
                // Master sends dirty block data. Relay to all slaves.
                if (clientOrder[0] === ws) {
                    const bundle = JSON.stringify({
                        type: 'field_blocks_sync',
                        blocks: data.blocks,
                        tick: data.tick,
                        flip: data.flip
                    });
                    clientOrder.forEach((client, idx) => {
                        if (idx > 0 && client.readyState === WebSocket.OPEN) {
                            client.send(bundle);
                        }
                    });
                    hashStore = {};
                    console.log(`Block sync relayed: ${Object.keys(data.blocks).length} blocks.`);
                }
            }
        } catch (e) {}
    });

    // 4. Handle disconnect — promote next in line
    ws.on('close', () => {
        const wasMaster = clientOrder[0] === ws;
        clientOrder = clientOrder.filter(c => c !== ws);
        delete hashStore[ws._clientId];
        console.log(`Client #${ws._clientId} disconnected. Total: ${clientOrder.length}${wasMaster && clientOrder.length > 0 ? '. New master: #' + clientOrder[0]._clientId : ''}`);
        if (clientOrder.length > 0) {
            broadcastRole();
        }
    });
});

// 5. Scheduler — Adaptive heartbeat + piggybacking
setInterval(() => {
    let sentData = false;

    // Scheduled settings changes -> broadcast at future tick
    if (pendingSettings) {
        const executeAt = globalTick + NETWORK_BUFFER_TICKS;
        const bundle = JSON.stringify({
            type: 'settings_at',
            tick: executeAt,
            st: globalTick,
            values: pendingSettings
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(bundle);
        });
        pendingSettings = null;
        lastDataTick = globalTick;
        sentData = true;
    }

    // Drag events -> broadcast at future tick
    if (pendingEvents.length > 0) {
        const batch = pendingEvents.splice(0, 8);
        const executeAt = globalTick + NETWORK_BUFFER_TICKS;
        const bundle = JSON.stringify({
            type: 'net_bundle',
            tick: executeAt,
            st: globalTick,
            events: batch
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(bundle);
        });
        lastDataTick = globalTick;
        sentData = true;
    }

    // Adaptive heartbeat:
    // - First CALIBRATION_TICKS: every 5 ticks (fast EMA convergence)
    // - After: every HEARTBEAT_CONVERGED ticks (low idle traffic)
    // - Skip if we already sent data this window (piggybacking)
    if (globalTick > CALIBRATION_TICKS) heartbeatInterval = HEARTBEAT_CONVERGED;

    if (clientOrder.length > 0
        && (globalTick % heartbeatInterval === 0)
        && !sentData
        && (globalTick - lastDataTick >= heartbeatInterval)) {
        const tickSync = JSON.stringify({ type: 'tick', st: globalTick });
        clientOrder.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(tickSync);
        });
    }

    globalTick++;
}, TICK_RATE);

server.listen(PORT, () => {
    console.log(`TWIST-J Server on port ${PORT}. Buffer=${NETWORK_BUFFER_TICKS}. Adaptive heartbeat (${heartbeatInterval}->${HEARTBEAT_CONVERGED} ticks). Soft sync + block hash.`);
});

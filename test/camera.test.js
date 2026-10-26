"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const Camera = require("../CameraSource");

const root = process.env.HOMEBRIDGE_TEST_ROOT || path.dirname(path.dirname(require.resolve("homebridge")));
const apiPath = path.join(root, existsSync(path.join(root, "dist/api.js")) ? "dist/api.js" : "lib/api.js");
const apiModule = import(pathToFileURL(apiPath).href);
const log = Object.assign(() => {}, { debug() {} });

async function setup(cameras = [{ name: "Website 1", url: "https://example.invalid" }]) {
    const { HomebridgeAPI } = await apiModule;
    const api = new HomebridgeAPI();
    let Platform;
    api.on("registerPlatform", (name, constructor) => { Platform = constructor; });
    require("../index")(api);
    let published;
    api.on("publishExternalAccessories", accessories => { published = accessories; });
    new Platform(log, { cameras }, api);
    api.signalFinished();
    return { api, published };
}

test("publishes four stable, distinct camera accessories with two RTP services each", async () => {
    const cameras = Array.from({ length: 4 }, (_, i) => ({
        id: `camera-${i + 1}`, name: `Website ${i + 1}`, url: "https://example.invalid"
    }));
    const { api, published } = await setup(cameras);
    const again = await setup(cameras);
    assert.equal(published.length, 4);
    assert.equal(new Set(published.map(a => a.UUID)).size, 4);
    assert.deepEqual(published.map(a => a.UUID), again.published.map(a => a.UUID));
    for (const accessory of published) {
        assert.equal(accessory.category, api.hap.Categories.CAMERA);
        assert.equal(accessory._associatedPlugin, "homebridge-website-to-camera");
        assert.equal(accessory.services.filter(s => s.UUID === api.hap.Service.CameraRTPStreamManagement.UUID).length, 2);
    }
});

test("a snapshot reaches the real HAP CameraController without launching Chromium", async () => {
    const { published } = await setup();
    const controller = published[0]._associatedHAPAccessory.controllers.camera.controller;
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    controller.delegate.screenshotHelper.getScreenshot = async () => image;
    assert.deepEqual(await controller.handleSnapshotRequest(240, 320, "Website 1"), image);
});

test("real HAP SetupEndpoints accepts the prepareStream response through its once wrapper", async () => {
    const { api, published } = await setup();
    const { uuid } = api.hap;
    const hbRequire = createRequire(apiPath);
    let hapEntry;
    try { hapEntry = hbRequire.resolve("@homebridge/hap-nodejs"); }
    catch { hapEntry = hbRequire.resolve("hap-nodejs"); }
    const tlv = require(path.join(path.dirname(hapEntry), "lib/util/tlv.js"));
    const controller = published[0]._associatedHAPAccessory.controllers.camera.controller;
    controller.delegate.getCurrentIp = () => "127.0.0.1";
    controller.delegate.handleSnapshotRequest = (request, callback) => callback(null, Buffer.from("stub"));
    const stream = controller.streamManagements[0];
    const session = uuid.generate("offline-stream");
    const port = number => { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(number); return buffer; };
    const address = tlv.encode(1, 0, 2, "127.0.0.1", 3, port(5010), 4, port(5011));
    const srtp = tlv.encode(1, 0, 2, Buffer.alloc(16), 3, Buffer.alloc(14));
    const request = tlv.encode(1, uuid.write(session), 3, address, 4, srtp, 5, srtp).toString("base64");
    const connection = Object.assign(new EventEmitter(), {
        sessionID: "offline-connection", localAddress: "127.0.0.1",
        getLocalAddress: () => "127.0.0.1"
    });
    try {
        const error = await new Promise(resolve => stream.handleSetupEndpoints(request, resolve, connection));
        assert.equal(error, undefined);
        assert.equal(tlv.decode(Buffer.from(stream.setupEndpointsResponse, "base64"))[2][0], 0);
    } finally {
        stream.handleSessionClosed();
    }
});

test("legacy camera source keeps its one-argument response callback", async () => {
    const { HomebridgeAPI } = await apiModule;
    const hap = new HomebridgeAPI().hap;
    const camera = new Camera(hap, { url: "https://example.invalid" }, log);
    camera.handleSnapshotRequest = () => {};
    camera.getCurrentIp = () => "127.0.0.1";
    const request = { sessionID: Buffer.alloc(16), targetAddress: "127.0.0.1" };
    // Arity 2 deliberately: callback declarations do not define the protocol.
    let received;
    camera.prepareStream(request, function (response, unused) { received = [response, unused]; });
    assert.equal(received[0].address.type, "v4");
    assert.equal(received[1], undefined);
});

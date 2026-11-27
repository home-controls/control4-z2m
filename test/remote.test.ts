import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {PROFILE_BUTTON, PROFILE_NETWORK} from "../src/core/constants";
import {rgb332, rgb332Hex} from "../src/devices/remote";
import {Rig, tick} from "./rig";

let rig: Rig;
const R250 = "0x000fff00000000e1";
const R260 = "0x000fff00000000e2";

beforeEach(() => {
    vi.useFakeTimers();
    rig = new Rig();
    rig.add(R250, "C4-SR250B", {type: "EndDevice"});
    rig.add(R260, "C4-SR260", {type: "EndDevice"});
    rig.start();
});

afterEach(() => {
    rig.stop();
    vi.useRealTimers();
});

const set = async (ieee: string, key: string, value: unknown) => {
    const p = rig.runtime.set(ieee, key, value, {message: {[key]: value}});
    await tick(100);
    return p;
};

describe("SR250 LCD rows", () => {
    it("defaults the room and sends rows in one frame", async () => {
        expect(rig.last(R250)).toMatchObject({room_name: "Home", active_source: ""});
        await set(R250, "room_name", "Kitchen");
        expect(rig.cmds().at(-1)).toBe('c4.ln.ri "Kitchen" ""');
        const from = rig.transport.sent.length;
        await set(R250, "set_room_info", {room: "Den", source: "Apple TV"});
        expect(rig.cmds(from)).toEqual(['c4.ln.ri "Den" "Apple TV"']);
    });

    it("uses the device option as the fallback room", () => {
        (rig.devices.get(R250) as {options: Record<string, unknown>}).options.lcd_default_room = "Great Room";
        expect((rig.runtime.get(R250) as unknown as {room(): string}).room()).toBe("Great Room");
    });

    it("re-sends undelivered rows on the next key press", async () => {
        rig.transport.failWith = () => Object.assign(new Error("asleep"), {name: "DeliveryError"});
        await set(R250, "room_name", "Porch");
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        rig.ascii(R250, "0t0001 sa c4.zr.bb 10 0000 0000 00000000");
        await tick(100);
        expect(rig.cmds(from)).toContain('c4.ln.ri "Porch" ""');
    });

    it("answers a motion wake with the clock then the rows", async () => {
        await set(R250, "room_name", "Bedroom");
        const from = rig.transport.sent.length;
        rig.ascii(R250, "0t0001 sa c4.zr.mot");
        await tick(1000);
        const cmds = rig.cmds(from).filter((c) => !c.startsWith("c4.zr.bl"));
        expect(cmds[0]).toMatch(/^c4\.zr\.tm [0-9a-f]{2} [0-9a-f]{2} [0-9a-f]{2} 0[1-7]$/);
        expect(cmds[1]).toBe('c4.ln.ri "Bedroom" ""');
        expect(rig.actions(R250)).toContain("motion_wake");
        // A second wake inside 5 s refreshes nothing.
        const n = rig.transport.sent.length;
        rig.ascii(R250, "0t0002 sa c4.zr.mot");
        await tick(100);
        expect(rig.cmds(n).filter((c) => !c.startsWith("c4.zr.bl"))).toEqual([]);
    });

    it("commissions the remote and binds cluster 0x0001", async () => {
        await tick(20_000);
        const cmds = rig.cmds();
        expect(cmds.some((c) => c.startsWith("c4.zr.tm "))).toBe(true);
        expect(cmds).toContain('c4.zr.loc 00 0f "en_US"');
        expect(cmds).toContain('c4.ln.ri "Home" ""');
        expect(rig.binds.filter((b) => b.ieee === R250)).toEqual([
            {ieee: R250, ep: 197, cluster: 1},
            {ieee: R250, ep: 1, cluster: 1},
        ]);
    });
});

describe("SR250 keys and menus", () => {
    it("maps its own key layout (select = 0x2a)", () => {
        rig.ascii(R250, "0t0001 sa c4.zr.bb 2a 0000 0000 00000000");
        rig.ascii(R250, "0t0002 sa c4.zr.bh 0d 0000 0000");
        rig.ascii(R250, "0t0003 sa c4.zr.be 0d 0000 0000");
        expect(rig.actions(R250)).toEqual(["select_press", "volume_up_hold", "volume_up_release"]);
    });

    it("publishes ZHA command names and a control4/event for each key", () => {
        rig.ascii(R250, "0t0001 sa c4.zr.bb 0d 0000 0000 00000000");
        rig.ascii(R250, "0t0002 sa c4.zr.bh 0d 0000 0000");
        rig.ascii(R250, "0t0003 sa c4.zr.be 0d 0000 0000");
        expect(rig.events.map((e) => e.command)).toEqual(["remote_button_short_press", "remote_button_long_press", "remote_button_short_release"]);
        expect(rig.events[0]).toMatchObject({
            ieee: R250,
            model: "C4-SR250B",
            action: "volume_up_press",
            button: "volume_up",
            gesture: "press",
            button_id: 0x0d,
        });
    });

    it("carries the picked item on the menu_select event", async () => {
        await set(R250, "show_list", {title: "Watch", items: ["YouTube", "Netflix"]});
        rig.ascii(R250, "0t0001 sa c4.ln.is 0002 0000");
        await tick(100);
        expect(rig.events.at(-1)).toMatchObject({
            action: "menu_select",
            command: "menu_select",
            item: "YouTube",
            title: "Watch",
            selected_index: 0,
            list_id: 2,
        });
    });

    it("shows a list and answers gi with the item count", async () => {
        await set(R250, "show_list", {title: "Watch", items: ["YouTube", "Netflix", "Plex"]});
        expect(rig.texts().at(-1)).toMatch(/^0i[0-9a-f]{4} c4\.ln\.sl 0002 0003 0000 "\x81Watch"$/);
        rig.ascii(R250, "0ic444 c4.ln.gi 0002 0000 0003 00");
        await tick(100);
        expect(rig.texts().at(-1)).toBe('0rc444 000 0003 "\x01YouTube" "\x01Netflix" "\x01Plex"');
    });

    it("lets the gi answer format be changed live", async () => {
        await set(R250, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        await set(R250, "gi_icon", 0x100);
        await set(R250, "gi_max_items", 1);
        await set(R250, "gi_reply_ep", 197);
        rig.ascii(R250, "0ic444 c4.ln.gi 0002 0001 0002 00");
        await tick(100);
        expect(rig.texts().at(-1)).toBe('0rc444 000 0001 "Netflix"');
        expect(rig.transport.sent.at(-1)?.frame.dstEp).toBe(197);
        await set(R250, "gi_template", "0r{seq} 000 {list} {items}");
        await set(R250, "gi_item_template", "{index}={label}");
        rig.ascii(R250, "0ic445 c4.ln.gi 0002 0000 0002 00");
        await tick(100);
        expect(rig.texts().at(-1)).toBe("0rc445 000 0002 0000=YouTube");
    });

    it("keeps the room on row 1 after a pick and closes the list", async () => {
        await set(R250, "room_name", "Living Room");
        await set(R250, "show_list", {title: "Watch", items: ["YouTube", "Netflix"]});
        rig.ascii(R250, "0t0001 sa c4.ln.is 0002 0001");
        await tick(200);
        expect(rig.cmds().slice(-2)).toEqual(['c4.ln.ri "Living Room" "Netflix"', "c4.ln.le"]);
        expect(rig.last(R250).active_source).toBe("Netflix");
        const ev = rig.published.find((p) => p.payload.action === "menu_select")?.payload;
        expect(ev).toMatchObject({action_item: "Netflix", action_title: "Watch", action_selected_index: 1});
    });

    it("reports a cancel and closes the list", async () => {
        await set(R250, "show_list", {title: "Watch", items: ["A"]});
        rig.ascii(R250, "0t0001 sa c4.ln.cn 0002 0000");
        await tick(100);
        expect(rig.actions(R250)).toContain("menu_cancel");
        expect(rig.cmds().at(-1)).toBe("c4.ln.le");
    });

    it("pages the open list by 5 with page up / page down", async () => {
        await set(R250, "show_list", {title: "T", items: Array.from({length: 12}, (_, i) => `i${i}`)});
        rig.ascii(R250, "0t0001 sa c4.zr.bb 0a 0000 0000 00000000");
        await tick(200);
        expect(
            rig
                .texts()
                .filter((t) => t.includes("c4.ln.sl"))
                .at(-1),
        ).toContain(" 000c 0005 ");
        rig.ascii(R250, "0t0002 sa c4.zr.bb 0a 0000 0000 00000000");
        await tick(200);
        rig.ascii(R250, "0t0003 sa c4.zr.bb 0a 0000 0000 00000000");
        await tick(200);
        expect(
            rig
                .texts()
                .filter((t) => t.includes("c4.ln.sl"))
                .at(-1),
        ).toContain(" 000c 000b ");
        rig.ascii(R250, "0t0004 sa c4.zr.bb 04 0000 0000 00000000");
        await tick(200);
        expect(
            rig
                .texts()
                .filter((t) => t.includes("c4.ln.sl"))
                .at(-1),
        ).toContain(" 000c 0006 ");
    });

    it("reads the battery on wake and caches it", async () => {
        rig.ascii(R250, "0t0001 sa c4.zr.bb 10 0000 0000 00000000");
        await tick(100);
        expect(
            rig
                .texts()
                .filter((t) => t.startsWith("0g"))
                .map((t) => t.split(" ")[1]),
        ).toEqual(["c4.zr.bl"]);
        rig.reply(R250, "64");
        expect(rig.last(R250).battery).toBe(100);
    });

    it("allows read-only probe Gets and refuses reset-like names", async () => {
        await set(R250, "c4_get", "c4.sy.fwv");
        expect(rig.texts().at(-1)).toMatch(/^0g[0-9a-f]{4} c4\.sy\.fwv$/);
        await expect(rig.runtime.set(R250, "c4_get", "c4.sy.rst", {message: {}})).rejects.toThrow(/refused/);
        await expect(rig.runtime.set(R250, "c4_send", "c4.zr.x 1", {message: {}})).rejects.toThrow(/disabled/);
        // The ZHA-named aliases go through the same guards.
        await expect(rig.runtime.set(R250, "send_raw", {cmd: "c4.zr.x 1", dst_ep: 1}, {message: {}})).rejects.toThrow(/disabled/);
        await expect(rig.runtime.set(R250, "send_get", {cmd: "c4.sy.rst", dst_ep: 1}, {message: {}})).rejects.toThrow(/refused/);
    });
});

describe("LCD text length", () => {
    it("shortens room / source / message / title to fit one frame", async () => {
        const long = "A very long now playing title from some album - with a remix name (2024 remaster)";
        await set(R250, "set_room_info", {room: "The Upstairs Family Room Over The Garage", source: long});
        await set(R250, "display_message", long);
        await set(R250, "show_list", {title: long, items: "One|Two"});
        await tick(500);
        const frames = rig.transport.sent.filter((s) => s.frame.profile === 0xc25c).slice(-3);
        for (const f of frames) expect(f.frame.data.length).toBeLessThanOrEqual(70);
        expect(frames[0].text).toMatch(/^0s[0-9a-f]{4} c4\.ln\.ri "The Upstairs Family Room" "A very long/);
        // The full text is still what Zigbee2MQTT shows.
        expect(rig.store.get(R250, "active_source")).toBe(long);
    });
});

describe("SR260 text colour", () => {
    it("maps #rrggbb to RGB332 and sends c4.zr.tc", async () => {
        expect(rgb332("#ff0000")).toBe(0xe0);
        expect(rgb332("#00ff00")).toBe(0x1c);
        expect(rgb332([0, 0, 255])).toBe(0x03);
        expect(rgb332({r: 176, g: 208, b: 224})).toBe(0xbb);
        expect(rgb332("")).toBeUndefined();
        const from = rig.transport.sent.length;
        await set(R260, "text_color", "#ff0000");
        expect(rig.cmds(from)).toEqual(["c4.zr.tc e0"]);
    });

    it("re-applies the colour after the rows", async () => {
        await set(R260, "text_color", "#00ff00");
        const from = rig.transport.sent.length;
        await set(R260, "room_name", "Den");
        expect(rig.cmds(from)).toEqual(['c4.ln.ri "Den" ""', "c4.zr.tc 1c"]);
    });

    it("takes the byte as a number or a decimal string, and palette names", () => {
        expect(rgb332(224)).toBe(0xe0);
        expect(rgb332("224")).toBe(0xe0);
        expect(rgb332(" 3 ")).toBe(0x03);
        expect(rgb332("red")).toBe(0xe0);
        expect(rgb332("#0f0")).toBe(0x1c);
        for (const bad of ["#ff000", "notacolour", "256", 3.5, -1, {r: 1, g: 2}, [1, 2]]) expect(() => rgb332(bad)).toThrow();
    });

    it("publishes the colour it applied as #rrggbb", async () => {
        expect(rgb332Hex(0xe0)).toBe("#ff0000");
        expect(rgb332Hex(0x03)).toBe("#0000ff");
        expect(rgb332Hex(0xff)).toBe("#ffffff");
        expect(await set(R260, "text_color", {r: 0, g: 0, b: 255})).toEqual({text_color: "#0000ff"});
        expect(await set(R260, "text_color", [255, 0, 0])).toEqual({text_color: "#ff0000"});
        expect(await set(R260, "text_color", "224")).toEqual({text_color: "#ff0000"});
        expect(await set(R260, "text_color", "")).toEqual({text_color: ""});
    });

    it("keeps the saved colour when the input isn't a colour", async () => {
        await set(R260, "text_color", "#ff0000");
        const bad = rig.runtime.set(R260, "text_color", "#ff000", {message: {}}).catch((e: Error) => e);
        await tick(100);
        expect(await bad).toBeInstanceOf(Error);
        const from = rig.transport.sent.length;
        await set(R260, "room_name", "Den");
        expect(rig.cmds(from)).toEqual(['c4.ln.ri "Den" ""', "c4.zr.tc e0"]);
    });

    it("re-sends the colour at commissioning and on a wake", async () => {
        await set(R260, "text_color", "#00ff00");
        let from = rig.transport.sent.length;
        await tick(20_000); // the start-up commissioning
        expect(rig.cmds(from)).toContain("c4.zr.tc 1c");
        await tick(60_000);
        from = rig.transport.sent.length;
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(2_000);
        expect(rig.cmds(from)).toContain("c4.zr.tc 1c");
    });

    it("doesn't count delivered rows as undelivered when only the colour fails", async () => {
        await set(R260, "text_color", "#00ff00");
        rig.transport.failWith = (f) =>
            f.data.toString("latin1").includes("c4.zr.tc") ? Object.assign(new Error("asleep"), {name: "DeliveryError"}) : undefined;
        await set(R260, "room_name", "Den");
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        rig.ascii(R260, "0t0001 sa c4.zr.bb 10 0000 0000 00000000");
        await tick(1_000);
        expect(rig.cmds(from).filter((c) => c.startsWith("c4.ln.ri"))).toEqual([]);
    });
});

describe("SR260", () => {
    it("answers gi without the item count", async () => {
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix|Plex"});
        rig.ascii(R260, "0ib572 c4.ln.gi 0002 0000 0003 00");
        await tick(100);
        expect(rig.texts().at(-1)).toBe('0rb572 000 "\x01YouTube" "\x01Netflix" "\x01Plex"');
    });

    it("takes [xx] glyph codes off the title and items", async () => {
        await set(R260, "show_list", {title: "[a6]Settings", items: "[b1]Lights|Fans|TV"});
        expect(rig.texts().at(-1)).toMatch(/"\xa6Settings"$/);
        rig.ascii(R260, "0ib573 c4.ln.gi 0002 0000 0003 00");
        await tick(100);
        expect(rig.texts().at(-1)).toBe('0rb573 000 "\xb1Lights" "\x01Fans" "\x01TV"');
        rig.ascii(R260, "0t0001 sa c4.ln.is 0002 0000");
        await tick(100);
        expect(rig.published.find((p) => p.payload.action === "menu_select")?.payload.action_item).toBe("Lights");
    });

    it("pops a message up and clears it", async () => {
        await set(R260, "show_message", {message: "Doorbell", seconds: 5});
        expect(rig.cmds().at(-1)).toBe('c4.ln.dm 5a "Doorbell"');
        await tick(5500);
        expect(rig.cmds().at(-1)).toBe("c4.ln.le");
    });

    it("uses its own key map and page keys", async () => {
        rig.ascii(R260, "0t0001 sa c4.zr.bb 10 0000 0000 00000000");
        expect(rig.actions(R260)).toEqual(["select_press"]);
        await set(R260, "show_list", {title: "T", items: Array.from({length: 8}, (_, i) => `i${i}`)});
        rig.ascii(R260, "0t0002 sa c4.zr.bb 0a 0000 0000 00000000");
        await tick(200);
        expect(
            rig
                .texts()
                .filter((t) => t.includes("c4.ln.sl"))
                .at(-1),
        ).toContain(" 0008 0005 ");
        rig.ascii(R260, "0t0003 sa c4.zr.bb 09 0000 0000 00000000");
        await tick(200);
        expect(
            rig
                .texts()
                .filter((t) => t.includes("c4.ln.sl"))
                .at(-1),
        ).toContain(" 0008 0000 ");
    });

    it("caches the battery it announces", () => {
        rig.ascii(R260, "0t0001 sa c4.zr.bl 3a");
        expect(rig.last(R260).battery).toBe(0x3a);
    });
});
describe("list ids", () => {
    it("never uses list 0001 (an SR260 draws it as a heading, not a menu), and wraps past it", async () => {
        await set(R260, "show_list", {title: "Watch", items: "A|B"});
        expect(rig.texts().at(-1)).toMatch(/ c4\.ln\.sl 0002 /);
        // biome-ignore lint/suspicious/noExplicitAny: private counter
        (rig.runtime.get(R260) as any).listId = 0xffff;
        await set(R260, "show_list", {title: "Watch", items: "A|B"});
        expect(rig.texts().at(-1)).toMatch(/ c4\.ln\.sl 0002 /);
    });
});

describe("screen after a wake or re-join", () => {
    const identityRead = () => rig.inject(R260, PROFILE_NETWORK, Buffer.from([0x00, 0x5a, 0x00, 0x08, 0x00, 0x09, 0x00, 0x0a, 0x00]));
    /** R260's sends after `from`, without the sequence and the battery poll. */
    const sent260 = (from: number) =>
        rig.transport.sent
            .slice(from)
            .filter((x) => x.nwk === rig.nwk(R260) && x.frame.profile === PROFILE_BUTTON)
            .map((x) => x.text.replace(/^0[sgir][0-9a-f]{4} /, ""))
            .filter((c) => !c.startsWith("c4.zr.bl"));
    // Past the start-up commissioning.
    beforeEach(() => tick(60_000));
    const fails = () => Object.assign(new Error("delivery failed (status 0x66)"), {name: "DeliveryError"});

    it("re-shows the open menu, with the same list id, after the clock and rows", async () => {
        await set(R260, "room_name", "Den");
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        const sl = rig.cmds().at(-1);
        expect(sl).toMatch(/^c4\.ln\.sl /);
        await tick(10_000);
        const from = rig.transport.sent.length;
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(1_000);
        const cmds = sent260(from);
        expect(cmds.map((c) => c.split(" ")[0])).toEqual(["c4.zr.tm", "c4.ln.ri", "c4.ln.sl"]);
        expect(cmds.at(-1)).toBe(sl);
    });

    it("does not re-show a menu that was picked while the refresh was sending the rows", async () => {
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        const list = rig.cmds().at(-1)?.split(" ")[1];
        await tick(10_000);
        rig.transport.latency = 150;
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(700); // battery poll, tm, rows (done at 650 ms): inside the 200 ms gap before the menu
        const from = rig.transport.sent.length;
        rig.ascii(R260, `0t0002 sa c4.ln.is ${list} 0000`);
        await tick(20_000);
        expect(sent260(from).filter((c) => c.startsWith("c4.ln.sl"))).toEqual([]);
        expect(rig.events.at(-1)).toMatchObject({action: "menu_select", item: "YouTube"});
    });

    it("does not send a menu shown during the refresh a second time", async () => {
        rig.transport.latency = 150;
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(300); // the refresh is sending the clock and rows
        const from = rig.transport.sent.length;
        const shown = rig.runtime.set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"}, {message: {}});
        await tick(20_000);
        await shown;
        expect(sent260(from).filter((c) => c.startsWith("c4.ln.sl"))).toHaveLength(1);
    });

    it("sends one refresh when the wake and the identity read come together", async () => {
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        await tick(10_000);
        const from = rig.transport.sent.length;
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        identityRead();
        await tick(20_000);
        expect(sent260(from).map((c) => c.split(" ")[0])).toEqual(["c4.zr.tm", "c4.ln.ri", "c4.ln.sl"]);
    });

    it("retries a wake refresh while the remote re-joins, and refreshes on a later identity read inside the debounce", async () => {
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        await tick(10_000);
        // The wake: the remote is mid re-join, so everything fails at once (tries at 0 and 1.5 s).
        rig.transport.failWith = (f) => (f.profile === PROFILE_BUTTON ? fails() : undefined);
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(1_000);
        identityRead(); // re-joined; the refresh under way covers it
        await tick(1_000);
        rig.transport.failWith = undefined;
        let from = rig.transport.sent.length;
        await tick(5_000); // the try at 5.5 s
        expect(sent260(from).map((c) => c.split(" ")[0])).toEqual(["c4.zr.tm", "c4.ln.ri", "c4.ln.sl"]);
        from = rig.transport.sent.length;
        await tick(20_000);
        expect(sent260(from)).toEqual([]);
        // An identity read with nothing under way refreshes even inside the wake debounce; the
        // menu that wake's refresh re-showed is on the screen already, so it is not sent again.
        rig.ascii(R260, "0t0002 sa c4.zr.mot");
        await tick(1_000);
        from = rig.transport.sent.length;
        identityRead();
        await tick(1_000);
        expect(sent260(from).map((c) => c.split(" ")[0])).toEqual(["c4.zr.tm", "c4.ln.ri"]);
    });

    it("does not re-show a menu shown between a failed try and its retry", async () => {
        rig.transport.failWith = (f) => (f.profile === PROFILE_BUTTON ? fails() : undefined);
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(500); // the first try failed
        rig.transport.failWith = undefined;
        const from = rig.transport.sent.length;
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        await tick(20_000);
        expect(sent260(from).filter((c) => c.startsWith("c4.ln.sl"))).toHaveLength(1);
    });

    it("does not re-show a menu shown after the wake when the identity read comes", async () => {
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(500); // that wake's refresh is done
        const from = rig.transport.sent.length;
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"}); // out by 600 ms
        await tick(300);
        identityRead(); // about a second after the wake
        await tick(20_000);
        expect(sent260(from).filter((c) => c.startsWith("c4.ln.sl"))).toHaveLength(1);
    });

    it("retries only the menu when the rows went through and the menu did not", async () => {
        await set(R260, "show_list", {title: "Watch", items: "YouTube|Netflix"});
        await tick(10_000);
        let menuFails = 1;
        rig.transport.failWith = (f) => (f.data.toString("latin1").includes("c4.ln.sl") && menuFails-- > 0 ? fails() : undefined);
        const from = rig.transport.sent.length;
        rig.ascii(R260, "0t0001 sa c4.zr.mot");
        await tick(20_000);
        expect(sent260(from).map((c) => c.split(" ")[0])).toEqual(["c4.zr.tm", "c4.ln.ri", "c4.ln.sl"]);
    });
});

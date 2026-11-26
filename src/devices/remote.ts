/**
 * C4-SR250B / C4-SR260 remotes (ports of control4_sr250.py,
 * control4_remote.py, c4_display_cluster.py and C4RemoteButtonCluster).
 *
 * Buttons: c4.zr.bb (press) / bh (hold, repeats) / be (release).
 * LCD: c4.ln.ri "<room>" "<source>" (rows 1/2), c4.ln.sl (menu header), the
 * remote's c4.ln.gi page requests answered with the item labels, c4.ln.is /
 * cn (pick / cancel), c4.ln.le (close), c4.ln.dm (pop-up).
 * The remote sits at "waiting for network" until it is commissioned
 * (identity, clock, locale, room) and needs cluster 0x0001 bound to us.
 */

import {C4_CLUSTER, type Gesture, REMOTE_COMMANDS, SR250_BUTTONS, SR260_BUTTONS} from "../core/constants";
import {buildFrame, hex2, hex4, type ParsedFrame, parseHex, sanitize} from "../core/protocol";
import {isDeliveryFailure} from "../core/link";
import {C4Device, type Payload, type SetMeta, toNumber} from "./base";

/**
 * What every event type on a remote's Control4 events entity starts with
 * (ADR 0005). Its key commands already do (the ZHA remote quirks'
 * `remote_button_*` names); its other events get it. Zigbee2MQTT's own event
 * entity, with `experimental_event_entities` on, keeps `menu_select`,
 * `menu_cancel` and `motion_wake` as they are, and `event.received` on the
 * remote hears both entities: without the prefix each would run twice.
 */
export const REMOTE_EVENT_PREFIX = "remote_";

/**
 * The type a remote's event has on its Control4 events entity: `menu_select`
 * -> `remote_menu_select`, `remote_button_short_press` as it is. The event's
 * `command` keeps its name on both topics.
 */
export function remoteEventType(command: string): string {
    return command.startsWith(REMOTE_EVENT_PREFIX) ? command : `${REMOTE_EVENT_PREFIX}${command}`;
}

export const DEFAULT_ROOM = "Home";
const LOCALE = "en_US";
const WAKE_REFRESH_MIN = 5_000;
const DIAG_POLL = 30 * 60_000;
const PAGE_SIZE = 5;
const GI_MAX_FRAME = 70;
/** Longest frame (bytes, with CR LF) sent to a remote's LCD - the bound the menu pages already use. */
export const LCD_MAX_FRAME = GI_MAX_FRAME;
/** Room row length; the rest of the frame goes to the source row. */
export const ROOM_MAX = 24;
/** Sequence placeholder of the same width as a real one, for measuring. */
const SEQ0 = "0000";

/** `text`, shortened until `build(text)` fits one frame. */
export function fitLcd(build: (text: string) => string, text: string): string {
    let s = text;
    while (s && buildFrame(build(s)).length > LCD_MAX_FRAME) s = s.slice(0, -1);
    return s;
}
const DM_DEFAULT_ICON = 0x5a;
// Probe Gets never go out for names that look like reset / reboot / firmware commands.
const GET_BLOCKED = ["rst", "rb", "reset", "fw", "boot", "er" + "ase", "fac"];
const GET_ALLOWED = ["c4.sy.fwv"];

export const SR250_GI_TEMPLATE = "0r{seq} 000 {n} {items}";
export const SR260_GI_TEMPLATE = "0r{seq} 000 {items}";
export const GI_ITEM_TEMPLATE = '"{icon}{label}"';

const GLYPH = /^\[([0-9a-fA-F]{2})\]/;

export function splitGlyph(text: string): [number | undefined, string] {
    const m = GLYPH.exec(text);
    if (!m) return [undefined, text];
    return [Number.parseInt(m[1], 16), text.slice(m[0].length)];
}

function format(template: string, fields: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
        if (!(name in fields)) throw new Error(`unknown placeholder ${whole}`);
        return fields[name];
    });
}

interface Menu {
    listId: number;
    title: string;
    items: string[];
    icons?: (number | undefined)[];
    selectedIndex: number;
    cursor?: number;
}

export class Remote extends C4Device {
    protected buttons: Record<number, string> = SR250_BUTTONS;
    protected pageKeys: Record<string, number> = {"04": -1, "0a": 1};
    protected giTemplate = SR250_GI_TEMPLATE;
    protected titleIcon = 0x81;
    menu: Menu | undefined;
    private listId = 0;
    private rowsPending = false;
    private lastRefresh = Number.NEGATIVE_INFINITY;
    private lastDiag = Number.NEGATIVE_INFINITY;
    private bootstrapped = false;

    override start(hotLoad = false): void {
        if (this.bootstrapped) return;
        this.bootstrapped = true;
        // Commissioned before the hot-load: its next wake re-pushes the clock and the rows.
        if (!hotLoad) this.after(16_000, () => this.bootstrap());
    }

    // -- LCD rows -----------------------------------------------------------------

    room(): string {
        const v = this.setting<string>("room_name");
        if (v) return v;
        const opt = this.option("lcd_default_room");
        return typeof opt === "string" && opt.trim() ? opt.trim() : DEFAULT_ROOM;
    }

    source(): string {
        return this.setting<string>("active_source", "");
    }

    async sendRoomInfo(room: string, source: string): Promise<void> {
        const r = fitLcd((s) => `0s${SEQ0} c4.ln.ri "${s}" ""`, sanitize(room).slice(0, ROOM_MAX));
        const src = fitLcd((s) => `0s${SEQ0} c4.ln.ri "${r}" "${s}"`, sanitize(source));
        await this.set(`c4.ln.ri "${r}" "${src}"`);
    }

    /** Push the cached rows; false when the remote did not take it (re-sent on wake). */
    async pushRoomInfo(): Promise<boolean> {
        try {
            await this.sendRoomInfo(this.room(), this.source());
        } catch (error) {
            this.rowsPending = true;
            this.log.warning(`Control4 ${this.name}: LCD rows undelivered (${(error as Error).message}) - will re-send when the remote wakes`);
            return false;
        }
        this.rowsPending = false;
        return true;
    }

    async sendTime(): Promise<void> {
        const now = new Date();
        const dow = now.getDay() === 0 ? 7 : now.getDay();
        await this.set(`c4.zr.tm ${hex2(now.getHours())} ${hex2(now.getMinutes())} ${hex2(now.getSeconds())} ${hex2(dow)}`);
    }

    async sendLocale(): Promise<void> {
        await this.set(`c4.zr.loc 00 0f "${LOCALE}"`);
    }

    async clearDisplay(): Promise<void> {
        await this.sendText(`0i${hex4(this.nextSeq())} c4.ln.le`);
    }

    async displayMessage(message: string, icon = DM_DEFAULT_ICON): Promise<void> {
        const text = fitLcd((s) => `0i${SEQ0} c4.ln.dm ${hex2(icon)} "${s}"`, sanitize(message));
        await this.sendText(`0i${hex4(this.nextSeq())} c4.ln.dm ${hex2(icon)} "${text}"`);
    }

    // -- commissioning -------------------------------------------------------------

    async bootstrap(): Promise<void> {
        for (let attempt = 0; attempt < 4 && this.alive; attempt++) {
            try {
                await this.ctx.sendIdentity(this, `${this.family}_bootstrap`);
                await this.sleep(400);
                await this.sendTime();
                await this.sleep(400);
                await this.sendLocale();
                await this.sleep(400);
                await this.sendRoomInfo(this.room(), this.source());
                this.rowsPending = false;
                this.log.info(`Control4 ${this.name}: commissioned (identity, clock, locale, room '${this.room()}') [${attempt + 1}/4]`);
                if (attempt === 0) {
                    await this.sleep(400);
                    for (const ep of [197, 1]) {
                        try {
                            await this.ctx.bind(this.ieee, ep, C4_CLUSTER);
                        } catch (error) {
                            this.log.debug(`Control4 ${this.name}: bind ep ${ep} failed: ${error}`);
                        }
                    }
                }
            } catch (error) {
                this.log.debug(`Control4 ${this.name}: bootstrap send failed [${attempt + 1}/4]: ${error}`);
            }
            await this.sleep(6_000);
        }
    }

    // -- receive -------------------------------------------------------------------

    override handleAscii(frame: ParsedFrame): void {
        const t = frame.tokens;
        if (frame.kind === "init" && t[1] === "c4.ln.gi" && t.length >= 5) {
            const listId = parseHex(t[2]);
            const offset = parseHex(t[3]);
            const count = parseHex(t[4]);
            if (listId !== undefined && offset !== undefined && count !== undefined) {
                this.spawn(this.answerGi(listId, offset, count, frame.seq));
                return;
            }
        }
        if (frame.kind === "reply" && t.length >= 4 && t[1] === "000" && t[2] === "c4.zr.bl") {
            this.setBattery(parseHex(t[3]));
        }
        super.handleAscii(frame);
    }

    private setBattery(level: number | undefined): void {
        if (level !== undefined && level >= 0 && level <= 100) this.publish({battery: level});
    }

    private fireKey(hex: string | undefined, gesture: Gesture): void {
        const id = parseHex(hex);
        if (id === undefined) return;
        const name = this.buttons[id];
        if (name === undefined) {
            this.log.warning(`Control4 ${this.name}: unmapped button 0x${hex2(id)}`);
            return;
        }
        const command = REMOTE_COMMANDS[gesture];
        this.emitAction(name, gesture, {action_button_id: id, ...(command ? {action_command: command} : {})}, false);
    }

    protected override onAnnounce(ns: string, data: string[]): void {
        switch (ns) {
            case "c4.zr.bb":
                this.fireKey(data[0], "press");
                break;
            case "c4.zr.bh":
                this.fireKey(data[0], "hold");
                break;
            case "c4.zr.be":
                this.fireKey(data[0], "release");
                break;
            case "c4.ln.is":
                this.menuSelect(parseHex(data[0]) ?? 0, parseHex(data[1]) ?? 0);
                break;
            case "c4.ln.ise":
                break; // release of the matching `is`
            case "c4.ln.cn":
                this.menuCancel(parseHex(data[0]) ?? 0, parseHex(data[1]) ?? 0);
                break;
            case "c4.zr.mot":
                this.emitEvent("motion_wake");
                break;
            case "c4.zr.bl":
                this.setBattery(parseHex(data[0]));
                break;
            default:
                this.log.debug(`Control4 ${this.name}: ${ns} ${data.join(" ")}`);
        }
        // What the Director does on wake: re-push the clock and the rows.
        const key = (data[0] ?? "").toLowerCase();
        if (ns === "c4.zr.bb" && key in this.pageKeys) this.pageList(this.pageKeys[key]);
        if (ns === "c4.zr.mot" || ns === "c4.zr.bb") this.diagPoll();
        if (ns === "c4.zr.mot") this.wakeRefresh(true);
        else if (ns === "c4.zr.bb" && this.rowsPending) this.wakeRefresh(false);
    }

    private wakeRefresh(sendTime: boolean): void {
        const now = this.ctx.now();
        if (now - this.lastRefresh < WAKE_REFRESH_MIN) return;
        this.lastRefresh = now;
        this.spawn(
            (async () => {
                if (sendTime) {
                    try {
                        await this.sendTime();
                    } catch (error) {
                        this.log.debug(`Control4 ${this.name}: wake tm failed: ${error}`);
                    }
                    await this.sleep(200);
                }
                await this.pushRoomInfo();
            })(),
        );
    }

    private diagPoll(): void {
        const now = this.ctx.now();
        if (now - this.lastDiag < DIAG_POLL) return;
        this.lastDiag = now;
        this.spawn(
            this.sendText(`0g${hex4(this.nextSeq())} c4.zr.bl`).catch(() => {
                this.lastDiag = Number.NEGATIVE_INFINITY; // asleep: retry on the next wake
            }),
        );
    }

    // -- menus -------------------------------------------------------------------

    /**
     * Never 0x0001: an SR260 draws list 1 as a centred heading (its first item)
     * with no title or count, not as a menu. 2 and up give the normal menu (the
     * Director's own lists start higher).
     */
    private nextListId(): number {
        const next = this.listId + 1;
        this.listId = next > 0xffff ? 2 : Math.max(next, 2);
        return this.listId;
    }

    async showList(title: string, items: string[], selectedIndex: number, titleIcon = this.titleIcon): Promise<void> {
        if (!items.length) throw new Error("show_list: items must contain at least one entry");
        const sel = Math.max(0, Math.min(items.length - 1, Math.trunc(selectedIndex) || 0));
        const listId = this.nextListId();
        this.menu = {listId, title, items, selectedIndex: sel};
        const head = (seq: string) => `0i${seq} c4.ln.sl ${hex4(listId)} ${hex4(items.length)} ${hex4(sel)} "${String.fromCharCode(titleIcon & 0xff)}`;
        const shown = fitLcd((s) => `${head(SEQ0)}${s}"`, sanitize(title));
        const cmd = `${head(hex4(this.nextSeq()))}${shown}"`;
        try {
            await this.sendText(cmd);
        } catch (error) {
            this.menu = undefined;
            if (isDeliveryFailure(error)) {
                this.log.warning(`Control4 ${this.name}: menu undelivered - the remote is probably asleep; press a key and retry`);
                return;
            }
            throw error;
        }
    }

    async closeList(): Promise<void> {
        this.menu = undefined;
        try {
            await this.clearDisplay();
        } catch (error) {
            this.log.debug(`Control4 ${this.name}: close_list undelivered: ${error}`);
        }
    }

    private pageList(direction: number): void {
        const menu = this.menu;
        if (!menu?.items.length) return;
        const cur = menu.cursor ?? menu.selectedIndex;
        const next = Math.max(0, Math.min(menu.items.length - 1, cur + direction * PAGE_SIZE));
        if (next === cur) return;
        this.spawn(
            (async () => {
                const icons = menu.icons;
                await this.showList(menu.title, menu.items, next);
                if (this.menu) {
                    this.menu.cursor = next;
                    if (icons) this.menu.icons = icons;
                }
            })(),
        );
    }

    private menuSelect(listId: number, idx: number): void {
        const menu = this.menu?.listId === listId ? this.menu : undefined;
        const item = menu && idx >= 0 && idx < menu.items.length ? menu.items[idx] : null;
        this.menu = undefined;
        this.emitEvent("menu_select", {action_list_id: listId, action_selected_index: idx, action_item: item, action_title: menu?.title ?? ""});
        this.log.info(`Control4 ${this.name}: menu_select list=0x${hex4(listId)} idx=${idx} item=${item}`);
        // Keep the room on row 1 and show the pick as the source, as the Director does.
        this.spawn(
            (async () => {
                if (item) {
                    this.saveSetting("active_source", item);
                    this.publish({active_source: item});
                }
                try {
                    await this.sendRoomInfo(this.room(), this.source());
                } catch {
                    // asleep
                }
                await this.closeList();
            })(),
        );
    }

    private menuCancel(listId: number, idx: number): void {
        const title = this.menu?.listId === listId ? this.menu.title : "";
        this.menu = undefined;
        this.emitEvent("menu_cancel", {action_list_id: listId, action_selected_index: idx, action_title: title});
        this.spawn(this.closeList());
    }

    giSetting(key: "gi_icon" | "gi_max_items" | "gi_reply_ep"): number {
        const defaults = {gi_icon: 0x01, gi_max_items: 0, gi_reply_ep: 1};
        const v = Number(this.setting<number>(key, defaults[key]));
        return Number.isFinite(v) ? v : defaults[key];
    }

    /** Answer a c4.ln.gi page request with as many labels as fit one frame. */
    async answerGi(listId: number, offset: number, count: number, seq: string): Promise<void> {
        const menu = this.menu;
        if (!menu || menu.listId !== listId) {
            this.log.debug(`Control4 ${this.name}: gi for list 0x${hex4(listId)} with no matching menu`);
            return;
        }
        const icon = this.giSetting("gi_icon");
        const maxItems = this.giSetting("gi_max_items");
        const replyEp = this.giSetting("gi_reply_ep") || 1;
        const prefix = icon <= 0xff ? String.fromCharCode(icon) : "";
        let items = count ? menu.items.slice(offset, offset + count) : menu.items.slice(offset);
        if (maxItems) items = items.slice(0, maxItems);
        const template = this.setting<string>("gi_template") || this.giTemplate;
        const itemTemplate = this.setting<string>("gi_item_template") || GI_ITEM_TEMPLATE;
        const fields = {seq, list: hex4(listId), offset: hex4(offset), count: hex4(count)};
        const render = (parts: string[]) => {
            const f = {...fields, n: hex4(parts.length), items: parts.join(" ")};
            try {
                return format(template, f).trimEnd();
            } catch {
                this.log.warning(`Control4 ${this.name}: bad gi_template '${template}'`);
                return format(this.giTemplate, f).trimEnd();
            }
        };
        const parts: string[] = [];
        for (let i = 0; i < items.length; i++) {
            const label = sanitize(items[i]);
            const glyph = menu.icons?.[offset + i];
            const ic = glyph !== undefined ? String.fromCharCode(glyph) : prefix;
            let part: string;
            try {
                part = format(itemTemplate, {icon: ic, label, index: hex4(offset + i)});
            } catch {
                part = format(GI_ITEM_TEMPLATE, {icon: ic, label});
            }
            if (parts.length && render([...parts, part]).length + 2 > GI_MAX_FRAME) break;
            parts.push(part);
        }
        try {
            await this.sendText(render(parts), replyEp);
        } catch (error) {
            this.log.warning(`Control4 ${this.name}: menu labels undelivered: ${error}`);
        }
    }

    // -- control -----------------------------------------------------------------

    protected async showListFromPayload(data: Record<string, unknown>): Promise<void> {
        const raw = data.items;
        const items = Array.isArray(raw) ? raw.map((x) => String(x ?? "")) : String(raw ?? "").split("|");
        await this.showList(String(data.title ?? ""), items, Number(data.selected_index ?? 0));
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        switch (key) {
            case "room_name":
            case "active_source": {
                const text = value === null || value === undefined ? "" : String(value);
                this.saveSetting(key, text);
                await this.pushRoomInfo();
                return {[key]: key === "room_name" ? this.room() : text};
            }
            case "set_room_info": {
                if (obj.room !== undefined) this.saveSetting("room_name", String(obj.room));
                if (obj.source !== undefined) this.saveSetting("active_source", String(obj.source));
                await this.pushRoomInfo();
                return {room_name: this.room(), active_source: this.source()};
            }
            case "show_list":
                await this.showListFromPayload(obj);
                return undefined;
            case "close_list":
                await this.closeList();
                return undefined;
            case "display_message": {
                const text = String(value ?? "");
                if (!text) await this.clearDisplay();
                else await this.displayMessage(text, Number(this.setting<number>("display_icon", DM_DEFAULT_ICON)) & 0xff);
                return {display_message: text};
            }
            case "display_icon": {
                const icon = Math.round(toNumber(value, 0, 255));
                this.saveSetting(key, icon);
                return {display_icon: icon};
            }
            case "gi_icon":
            case "gi_max_items":
            case "gi_reply_ep":
                this.saveSetting(key, Math.round(toNumber(value, 0, 0xffff)));
                return undefined;
            case "gi_template":
            case "gi_item_template":
                this.saveSetting(key, value ? String(value) : undefined);
                return undefined;
            case "c4_send":
            case "send_raw":
                throw new Error("raw Set frames are disabled on remotes (an SR250 once lost its firmware to a bad Set)");
            case "c4_get":
            case "send_get": {
                const cmd = String(value && typeof value === "object" ? (value as {cmd?: unknown}).cmd : value).trim();
                const name = cmd.split(" ")[0].toLowerCase();
                if (!cmd || (!GET_ALLOWED.includes(name) && GET_BLOCKED.some((b) => (name.split(".").pop() ?? "").includes(b)))) {
                    throw new Error(`refused probe Get '${cmd}'`);
                }
                break;
            }
        }
        return super.setValue(key, value, meta);
    }

    override initialState(): Payload {
        return {room_name: this.room(), active_source: this.source()};
    }
}

export class Sr260 extends Remote {
    protected override buttons = SR260_BUTTONS;
    protected override pageKeys = {"09": -1, "0a": 1};
    protected override giTemplate = SR260_GI_TEMPLATE;
    private messageTimer: NodeJS.Timeout | undefined;

    /** Titles / items may start with a `[xx]` glyph code from the icon table. */
    protected override async showListFromPayload(data: Record<string, unknown>): Promise<void> {
        const [titleIcon, title] = splitGlyph(String(data.title ?? ""));
        const raw = data.items;
        const rawItems = Array.isArray(raw) ? raw.map((x) => String(x ?? "")) : String(raw ?? "").split("|");
        const icons: (number | undefined)[] = [];
        const labels = rawItems.map((r) => {
            const [g, label] = splitGlyph(r);
            icons.push(g);
            return label;
        });
        await this.showList(title, labels, Number(data.selected_index ?? 0), titleIcon ?? 0x81);
        if (this.menu && icons.some((g) => g !== undefined)) this.menu.icons = icons;
    }

    async showMessage(message: string, icon: number | undefined, seconds: number): Promise<void> {
        this.cancel(this.messageTimer);
        this.messageTimer = undefined;
        if (!message) {
            await this.clearDisplay();
            return;
        }
        try {
            await this.displayMessage(message, icon === undefined ? DM_DEFAULT_ICON : icon & 0xff);
        } catch (error) {
            this.log.warning(`Control4 ${this.name}: message undelivered (${error})`);
            return;
        }
        if (seconds > 0) {
            this.messageTimer = this.after(seconds * 1000, async () => {
                this.messageTimer = undefined;
                if (this.menu) return;
                await this.clearDisplay().catch(() => undefined);
            });
        }
    }

    /** The rows, then the text colour when one is set: every path that pushes rows (setup, wake, /set) re-applies it. */
    override async sendRoomInfo(room: string, source: string): Promise<void> {
        await super.sendRoomInfo(room, source);
        const color = this.setting<number>("text_color_byte");
        if (typeof color === "number") await this.set(`c4.zr.tc ${hex2(color)}`);
    }

    override async setValue(key: string, value: unknown, meta: SetMeta): Promise<Payload | undefined> {
        if (key === "text_color") {
            const byte = rgb332(value);
            this.saveSetting("text_color_byte", byte);
            if (byte !== undefined) await this.set(`c4.zr.tc ${hex2(byte)}`);
            return {text_color: byte === undefined ? "" : String(value)};
        }
        if (key === "show_message") {
            const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {message: value};
            await this.showMessage(String(obj.message ?? ""), obj.icon === undefined ? undefined : Number(obj.icon), Number(obj.seconds ?? 0) || 0);
            return undefined;
        }
        return super.setValue(key, value, meta);
    }
}
/**
 * The SR260's text colour (c4.zr.tc) is one RGB332 byte: red bits 7-5, green
 * 4-2, blue 1-0 (256 colours; it also sets the text brightness). Takes
 * "#rrggbb", [r, g, b], {r, g, b} or the byte itself; empty leaves the
 * remote's own colour.
 */
export function rgb332(value: unknown): number | undefined {
    let rgb: number[] | undefined;
    if (typeof value === "number") return Math.max(0, Math.min(255, Math.round(value)));
    if (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())) {
        const h = value.trim().replace("#", "");
        rgb = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    } else if (Array.isArray(value) && value.length === 3) rgb = value.map(Number);
    else if (value && typeof value === "object") {
        const v = value as {r?: unknown; g?: unknown; b?: unknown};
        rgb = [v.r, v.g, v.b].map(Number);
    }
    if (!rgb || rgb.some((c) => !Number.isFinite(c))) return undefined;
    const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))));
    return (r & 0xe0) | ((g & 0xe0) >> 3) | (b >> 6);
}

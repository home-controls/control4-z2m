# The C4-SR260 remote on the wire

What a C4-SR260 (firmware 2.2.50) sends and expects, as seen with an 802.15.4 sniffer on the network's channel
and the extension's own logs, and what the extension does about each part. Frame text below is the Control4
text protocol on profile 0xC25C (`0s` set, `0g` get, `0i` interrupt, `0t` the device's own report, `0r` a
reply); `<seq>` is the frame's sequence number. The SR250 behaves the same where it has the feature; the text
colour and pop-up messages are the SR260's.

How it was captured: an ESP32-C6 sniffer on the network channel, its pcap decrypted with the network key, and
each frame counted once (a relayed frame is heard once per hop: deduplicate on NWK source, destination and
sequence). Profile 0xC25C carries the text frames; 0xC25D carries the check-ins and the identity exchange.

## Commissioning

A remote that joins sits at "waiting for network" until it is commissioned. The extension
(`src/devices/remote.ts`, `bootstrap`) does it four times, about 8 s apart:

1. the identity report on 0xC25D (the coordinator's IEEE and the controller attributes);
2. `0s<seq> c4.zr.tm <hh> <mm> <ss> <dow>`, the clock (local time, day of week);
3. `0s<seq> c4.zr.loc 00 0f "en_US"`, the locale;
4. `0s<seq> c4.ln.ri "<room>" "<source>"`, the two rows;
5. on an SR260 with a text colour saved, `0s<seq> c4.zr.tc <byte>`.

The first time, it also binds endpoints 197 and 1 to the coordinator for cluster 1. Each set is answered with
`0r<seq> 000`.

## Wake

Picking the remote up wakes it. It sends its 0xC25D check-in, then `0t<seq> sa c4.zr.mot`, which the
extension publishes as the `motion_wake` action and answers with the wake refresh: the clock (`c4.zr.tm`),
the rows (`c4.ln.ri`) and, on an SR260, the text colour (`c4.zr.tc`). A wake refresh runs at most once every
5 s. On a wake or a key press, at most every 30 minutes, the extension also asks the battery level (`0g<seq> c4.zr.bl`, answered `0r<seq> 000 c4.zr.bl <hex>`).

A typical wake, with its acknowledgements, is about eight frames:

```
remote  0t.. sa c4.zr.mot
coord   0s.. c4.zr.tm 0d 01 04 05        remote  0r.. 000
coord   0s.. c4.ln.ri "<room>" ""        remote  0r.. 000
coord   0s.. c4.zr.tc e0                 remote  0r.. 000
```

Today the wake refresh doesn't show an open menu again; pull request #4 adds that.

### The identity read after each wake

About a second to half a minute after each wake the remote reads the coordinator's identity on 0xC25D (a
Read Attributes, answered with the controller attributes 8, 9 and 0x0a). Over six wakes it came 34, 10, 8.4,
0.1, 3.8 and 25.5 s after `c4.zr.mot`, and once more after pairing with no wake before it. It is the remote
checking who its controller is, not a sign that it re-joined or lost its screen: anything that treats it as
"the remote needs its screen again" refreshes the screen a second time on most wakes. That is what review of
pull request #4 found; a fix treats an identity read within about a minute of a wake as part of that wake.

## The rows

`c4.ln.ri "<room>" "<source>"` sets both rows at once: row 1 the room (`room_name`), row 2 the source
(`active_source`). The extension caches both and sends them on commissioning, on every wake and on a `/set`.
It cuts the room to 24 characters, and each text to what fits in one frame (`fitLcd`). On an SR250 the room
row shows 19 characters. At 20 the 20th letter is cut off, and a 26-character row goes blank (read on an SR250,
2026-10-03). 21-25 were never tried, so where it goes blank is not known, and `ROOM_MAX` (24) is in that range.
The SR260's widths haven't been measured.

## Menus

```
coord   0i.. c4.ln.sl <list> <count> <selected> "\x81<title>"
remote  0i.. c4.ln.gi <list> <offset> <count> <icon>        (asks for a page of items)
coord   0r.. 000 "\x01<item>" "\x01<item>" ...
remote  0t.. sa c4.ln.is <list> 0000 <index>                (picked)
remote  0t.. sa c4.ln.ise <list> 0000 <index>
coord   0i.. c4.ln.le                                       (closes the list)
remote  0t.. sa c4.ln.cn <list> <index>                     (cancelled instead)
```

The extension answers `c4.ln.gi` with as many labels as fit one frame. The SR250's answer also carries the
item count, `0r<seq> 000 <n> <items>` (`SR250_GI_TEMPLATE`); the SR260 takes the items alone. A pick is published as `menu_select`
(with the list, index, item and title); the picked item becomes row 2 (`active_source`), and the rows are
sent again before the list closes. A cancel is `menu_cancel`.

**List 0001 is drawn as a heading**, its first item centred, with no title or count, not as a menu. The
extension's list ids start at 2 and wrap back to 2 after 0xffff.

## Text colour

`0s<seq> c4.zr.tc <byte>` sets the LCD text colour: one RGB332 byte, red in bits 7-5, green in 4-2, blue in
1-0, so 256 colours. **The byte also sets how bright the text is**: about 40 % of a colour (green `#006600`,
amber `#664d00`, white `#666666`) is dim but readable in a dark room. The remote keeps the last colour it was
sent while it sleeps; the extension sends it again with every row push anyway, so a remote that lost it gets
it back on its next wake.

In the extension it is the SR260's `text_color` key (`rgb332` and `rgb332Hex` in `src/devices/remote.ts`):
`#rrggbb`, `#rgb`, a palette name, `[r, g, b]`, `{r, g, b}`, or the byte itself as a number or decimal string.
Anything else is refused and the saved colour kept. Empty stops sending it, and the remote keeps the last
colour it had. The state shows the `#rrggbb` the byte gives (`#006600` comes back as `#006d00`), so compare
colours as bytes. `blueprints/c4_sr260_screen.yaml` does, and sends only when the byte changes.

## Keys

A key press is `0t<seq> sa c4.zr.bb <key> ...`, then `c4.zr.bh <key>` about every 100 ms while held, then
`c4.zr.be <key>` on release. The extension publishes `<button>_press`, `<button>_hold` and `<button>_release`
(the key names are in `src/core/constants.ts`). The page keys page an open menu.

## Pop-up messages

`0i<seq> c4.ln.dm <icon> "<text>"` shows a pop-up over the rows; the extension's `show_message` key sends it
and closes it again after `seconds`.

## Open

- The SR260's row and menu widths, measured as the SR250's were, and the SR250's own 21-25 range.
- Whether an SR250 wakes on pick-up under this extension: in the ZHA era, picking one up sent no `c4.zr.mot`.
- SR250 `c4.zr` names (every 2-letter one swept, ZHA era, 2026-10): `c4.zr.st` = `0f 0e`, its second byte
  following the backlight setting (14 at full, 0 at lowest; the first byte is unknown); `c4.zr.bt` = `00`
  (unknown); `c4.zr.loc` = `"en_US"`. Unknown `c4.zr` names answer `e00`, unknown `c4.sy` names `n01`. The
  3-letter names were not swept.
- What the remote does with the identity read's answer, and whether a wrong answer makes it ask again.

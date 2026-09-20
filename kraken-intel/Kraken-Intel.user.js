// ==UserScript==
// @name         Kraken Intel
// @namespace    kraken.intel
// @version      0.2.0
// @author       -TheKraken-
// @description  Locally captures and displays equipment Torn reveals on a manually opened attack page.
// @downloadURL  https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-intel/Kraken-Intel.user.js
// @updateURL    https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-intel/Kraken-Intel.user.js
// @match        https://www.torn.com/page.php*
// @match        https://www.torn.com/profiles.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const SCRIPT = "Kraken Intel";
    const VERSION = "0.2.0";
    const STORAGE_KEY = "kraken_intel_local_captures_v1";
    const PANEL_COLLAPSED_KEY = "kraken_intel_panel_collapsed";
    const MAX_LOCAL_CAPTURES = 50;
    const COMBAT_SLOTS = new Map([
        [1, "Primary"],
        [2, "Secondary"],
        [3, "Melee"],
        [4, "Armour"],
        [5, "Temporary"],
        [6, "Helmet"],
        [7, "Body armour"],
        [8, "Leg armour"],
        [9, "Foot/hand armour"]
    ]);

    const state = {
        panel: null,
        body: null,
        status: "Waiting for Torn attack data…",
        latest: null
    };

    function readValue(key, fallback) {
        try {
            return typeof GM_getValue === "function" ? GM_getValue(key, fallback) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeValue(key, value) {
        try {
            if (typeof GM_setValue === "function") GM_setValue(key, value);
        } catch (error) {
            console.warn(`[${SCRIPT}] Could not save local data`, error);
        }
    }

    function positiveInteger(value) {
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
    }

    function objectRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function pageDetails() {
        const url = new URL(W.location.href);
        if (url.pathname === "/page.php" && url.searchParams.get("sid") === "attack") {
            return { type: "attack", targetId: positiveInteger(url.searchParams.get("user2ID")) };
        }
        if (url.pathname === "/profiles.php") {
            return { type: "profile", targetId: positiveInteger(url.searchParams.get("XID")) };
        }
        return { type: "unsupported", targetId: null };
    }

    function currentTargetId() {
        return pageDetails().targetId;
    }

    function isAttackDataRequest(input) {
        const raw = typeof input === "string" ? input : input?.url || input?.href;
        if (typeof raw !== "string") return false;
        try {
            const url = new URL(raw, W.location.href);
            return url.origin === W.location.origin && url.searchParams.get("sid") === "attackData";
        } catch {
            return false;
        }
    }

    function visibleAndFocused() {
        return W.document.visibilityState === "visible" && W.document.hasFocus();
    }

    function firstItem(container) {
        return Array.isArray(container?.item) && objectRecord(container.item[0]) ? container.item[0] : null;
    }

    function normalizeBonuses(item) {
        if (!objectRecord(item?.currentBonuses)) return [];
        return Object.values(item.currentBonuses).flatMap((raw) => {
            if (!objectRecord(raw)) return [];
            const name = String(raw.title || raw.name || "Bonus").slice(0, 60);
            const numeric = Number(raw.value);
            return [{ name, value: Number.isFinite(numeric) ? numeric : null }];
        }).slice(0, 2);
    }

    function normalizeItem(item) {
        const equipSlot = Number(item.equipSlot);
        if (!COMBAT_SLOTS.has(equipSlot) && Number(item.ID) !== 999) return null;
        return {
            item_id: positiveInteger(item.ID),
            armoury_id: positiveInteger(item.armouryID ?? item.armoryID),
            equip_slot: equipSlot,
            slot_name: Number(item.ID) === 999 ? "Unarmed" : COMBAT_SLOTS.get(equipSlot),
            name: String(item.name || `Item #${item.ID || "unknown"}`).slice(0, 100),
            image_url: itemImageUrl(item),
            damage: Number.isFinite(Number(item.dmg ?? item.damage)) ? Number(item.dmg ?? item.damage) : null,
            accuracy: Number.isFinite(Number(item.acc ?? item.accuracy)) ? Number(item.acc ?? item.accuracy) : null,
            armour: Number.isFinite(Number(item.armor ?? item.armour)) ? Number(item.armor ?? item.armour) : null,
            bonuses: normalizeBonuses(item)
        };
    }

    function safeImageUrl(value) {
        if (typeof value !== "string" || !value.trim()) return null;
        try {
            const url = new URL(value, W.location.origin);
            return url.protocol === "https:" && (url.hostname === "www.torn.com" || url.hostname.endsWith(".torn.com"))
                ? url.href
                : null;
        } catch {
            return null;
        }
    }

    function itemImageUrl(item) {
        for (const candidate of [item.image, item.image_url, item.imageUrl, item.img]) {
            const valid = safeImageUrl(candidate);
            if (valid) return valid;
        }
        const itemId = positiveInteger(item.ID);
        return itemId ? `https://www.torn.com/images/items/${itemId}/large.png` : null;
    }

    function extractItems(defenderItems) {
        if (!objectRecord(defenderItems)) return [];
        return Object.values(defenderItems).flatMap((container) => {
            const item = firstItem(container);
            const normalized = item ? normalizeItem(item) : null;
            return normalized ? [normalized] : [];
        });
    }

    function buildCapture(data) {
        if (!visibleAndFocused()) return null;
        const db = objectRecord(data?.DB) ? data.DB : data;
        if (!objectRecord(db)) return null;

        const expectedTargetId = currentTargetId();
        const targetId = positiveInteger(db.defenderUser?.userID);
        if (!expectedTargetId || targetId !== expectedTargetId) return null;

        const items = extractItems(db.defenderItems);
        const meaningfulItems = items.filter((item) => item.item_id !== 999);
        if (!meaningfulItems.length) return null;

        return {
            schema_version: 1,
            target_id: targetId,
            target_name: typeof db.defenderUser?.playername === "string"
                ? db.defenderUser.playername.slice(0, 64)
                : null,
            observed_at: new Date().toISOString(),
            fight_id: positiveInteger(db.fightID ?? db.fightId),
            attack_status: typeof db.attackStatus === "string" ? db.attackStatus.slice(0, 32) : null,
            items
        };
    }

    function captureSignature(capture) {
        return JSON.stringify([capture.target_id, capture.items]);
    }

    function saveCapture(capture) {
        const stored = readValue(STORAGE_KEY, []);
        const captures = Array.isArray(stored) ? stored.filter(objectRecord) : [];
        const duplicate = captures.find((entry) =>
            entry.target_id === capture.target_id && captureSignature(entry) === captureSignature(capture)
        );

        if (duplicate) {
            duplicate.observed_at = capture.observed_at;
            duplicate.fight_id = capture.fight_id;
            duplicate.attack_status = capture.attack_status;
        } else {
            captures.unshift(capture);
        }

        captures.sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
        writeValue(STORAGE_KEY, captures.slice(0, MAX_LOCAL_CAPTURES));
    }

    function latestStoredCapture(targetId) {
        if (!targetId) return null;
        const stored = readValue(STORAGE_KEY, []);
        if (!Array.isArray(stored)) return null;
        return stored
            .filter((capture) => objectRecord(capture) && capture.target_id === targetId)
            .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0] || null;
    }

    function itemSummary(item) {
        const details = [];
        if (item.damage !== null) details.push(`DMG ${item.damage}`);
        if (item.accuracy !== null) details.push(`ACC ${item.accuracy}`);
        if (item.armour !== null) details.push(`ARM ${item.armour}`);
        for (const bonus of item.bonuses) {
            details.push(bonus.value === null ? bonus.name : `${bonus.name} ${bonus.value}%`);
        }
        return details.join(" · ");
    }

    function renderPanel() {
        if (!state.body) return;
        state.body.replaceChildren();

        const status = W.document.createElement("div");
        status.className = "ki-status";
        status.textContent = state.status;
        state.body.appendChild(status);

        if (!state.latest) return;
        const meta = W.document.createElement("div");
        meta.className = "ki-meta";
        const target = state.latest.target_name
            ? `${state.latest.target_name} [${state.latest.target_id}]`
            : `Player ${state.latest.target_id}`;
        meta.textContent = `${target} · ${new Date(state.latest.observed_at).toLocaleString()}`;
        state.body.appendChild(meta);

        const list = W.document.createElement("div");
        list.className = "ki-list";
        for (const item of state.latest.items) {
            if (item.item_id === 999) continue;
            const row = W.document.createElement("div");
            row.className = "ki-row";
            const imageWrap = W.document.createElement("span");
            imageWrap.className = "ki-image-wrap";
            const imageUrl = item.image_url || (item.item_id
                ? `https://www.torn.com/images/items/${item.item_id}/large.png`
                : null);
            if (imageUrl) {
                const image = W.document.createElement("img");
                image.className = "ki-image";
                image.src = imageUrl;
                image.alt = "";
                image.loading = "lazy";
                image.addEventListener("error", () => imageWrap.classList.add("is-missing"), { once: true });
                imageWrap.appendChild(image);
            } else {
                imageWrap.classList.add("is-missing");
            }
            const slot = W.document.createElement("span");
            slot.className = "ki-slot";
            slot.textContent = item.slot_name || "Item";
            const content = W.document.createElement("span");
            content.className = "ki-item";
            const name = W.document.createElement("strong");
            name.textContent = item.name;
            const details = W.document.createElement("small");
            details.textContent = itemSummary(item) || "No additional details supplied";
            content.append(name, details);
            row.append(imageWrap, slot, content);
            list.appendChild(row);
        }
        state.body.appendChild(list);

        const note = W.document.createElement("div");
        note.className = "ki-note";
        note.textContent = "Saved locally on this device only — nothing has been uploaded or shared.";
        state.body.appendChild(note);
    }

    function receiveAttackData(data) {
        const capture = buildCapture(data);
        if (!capture) {
            if (currentTargetId() && visibleAndFocused()) {
                state.status = "Attack data received, but Torn has not revealed a usable loadout.";
                renderPanel();
            }
            return;
        }
        saveCapture(capture);
        state.latest = capture;
        state.status = "Loadout detected and saved locally.";
        renderPanel();
        W.document.dispatchEvent(new CustomEvent("kraken-intel:capture", { detail: capture }));
        console.info(`[${SCRIPT}] Captured loadout for ${capture.target_id}`, capture);
    }

    function inspectResponse(response) {
        let clone;
        try {
            clone = response.clone();
        } catch (error) {
            console.warn(`[${SCRIPT}] Could not clone attack response`, error);
            return;
        }
        clone.json()
            .then((data) => {
                if (objectRecord(data)) receiveAttackData(data);
            })
            .catch((error) => console.warn(`[${SCRIPT}] Could not read attack response`, error));
    }

    function installFetchObserver() {
        const originalFetch = W.fetch;
        if (typeof originalFetch !== "function" || originalFetch.__krakenIntelWrapped) return;

        function krakenIntelFetch(...args) {
            const result = Reflect.apply(originalFetch, this, args);
            if (!isAttackDataRequest(args[0])) return result;
            return result.then((response) => {
                if (response?.ok) inspectResponse(response);
                return response;
            });
        }

        krakenIntelFetch.__krakenIntelWrapped = true;
        W.fetch = krakenIntelFetch;
    }

    function installStyles() {
        const style = W.document.createElement("style");
        style.textContent = `
            #kraken-intel-panel{position:fixed;z-index:2147483645;right:10px;bottom:10px;width:min(360px,calc(100vw - 20px));box-sizing:border-box;border:1px solid #177d86;border-radius:9px;background:#10171b;color:#e9f3f4;box-shadow:0 8px 28px #0009;font:12px/1.35 Arial,sans-serif;overflow:hidden}
            #kraken-intel-panel .ki-head{width:100%;border:0;background:linear-gradient(90deg,#0b4850,#177d86);color:#fff;padding:9px 11px;display:flex;align-items:center;justify-content:space-between;font-weight:700;cursor:pointer}
            #kraken-intel-panel .ki-version{opacity:.7;font-size:10px;font-weight:400}
            #kraken-intel-panel .ki-body{max-height:55vh;overflow:auto}
            #kraken-intel-panel.is-collapsed .ki-body{display:none}
            #kraken-intel-panel .ki-status,#kraken-intel-panel .ki-meta,#kraken-intel-panel .ki-note{padding:8px 10px}
            #kraken-intel-panel .ki-status{color:#7ee5ee}
            #kraken-intel-panel .ki-meta{border-top:1px solid #ffffff17;color:#aab8bc;font-size:10px}
            #kraken-intel-panel .ki-row{display:grid;grid-template-columns:52px 72px minmax(0,1fr);align-items:center;gap:7px;padding:7px 10px;border-top:1px solid #ffffff12}
            #kraken-intel-panel .ki-image-wrap{display:flex;width:50px;height:34px;align-items:center;justify-content:center;border-radius:5px;background:#ffffff0b;overflow:hidden}
            #kraken-intel-panel .ki-image-wrap.is-missing:after{content:"?";color:#60757a;font-weight:700}
            #kraken-intel-panel .ki-image-wrap.is-missing .ki-image{display:none}
            #kraken-intel-panel .ki-image{display:block;max-width:50px;max-height:34px;object-fit:contain}
            #kraken-intel-panel .ki-slot{color:#67cbd4;font-weight:700}
            #kraken-intel-panel .ki-item{display:flex;min-width:0;flex-direction:column}
            #kraken-intel-panel .ki-item strong{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
            #kraken-intel-panel .ki-item small{color:#aab8bc;white-space:normal}
            #kraken-intel-panel .ki-note{border-top:1px solid #ffffff17;color:#7f9297;font-size:10px}
        `;
        (W.document.head || W.document.documentElement).appendChild(style);
    }

    function mountPanel() {
        if (!currentTargetId() || !W.document.body || state.panel?.isConnected) return;
        const panel = W.document.createElement("section");
        panel.id = "kraken-intel-panel";
        const collapsed = readValue(PANEL_COLLAPSED_KEY, false) === true;
        panel.classList.toggle("is-collapsed", collapsed);

        const head = W.document.createElement("button");
        head.type = "button";
        head.className = "ki-head";
        const title = W.document.createElement("span");
        title.textContent = "🐙 Kraken Intel";
        const version = W.document.createElement("span");
        version.className = "ki-version";
        version.textContent = `Local intel v${VERSION}`;
        head.append(title, version);
        head.addEventListener("click", () => {
            const next = !panel.classList.contains("is-collapsed");
            panel.classList.toggle("is-collapsed", next);
            writeValue(PANEL_COLLAPSED_KEY, next);
        });

        const body = W.document.createElement("div");
        body.className = "ki-body";
        panel.append(head, body);
        W.document.body.appendChild(panel);
        state.panel = panel;
        state.body = body;
        renderPanel();
    }

    function onReady() {
        const page = pageDetails();
        const saved = latestStoredCapture(page.targetId);
        if (saved) {
            state.latest = saved;
            state.status = page.type === "profile"
                ? "Showing the latest loadout captured locally for this player."
                : "Showing previously captured local intel while checking for fresh attack data.";
        } else if (page.type === "profile") {
            state.status = "No locally captured loadout for this player yet.";
        }
        mountPanel();
        console.info(`[${SCRIPT}] Loaded local-only test v${VERSION}`);
    }

    if (!currentTargetId() || W.__krakenIntelInstalled) return;
    W.__krakenIntelInstalled = true;
    if (pageDetails().type === "attack") installFetchObserver();
    installStyles();
    if (W.document.readyState === "loading") {
        W.document.addEventListener("DOMContentLoaded", onReady, { once: true });
    } else {
        onReady();
    }
})();

// ==UserScript==
// @name         Kraken Intel
// @namespace    kraken.intel
// @version      0.5.0
// @author       -TheKraken-
// @description  Captures and shares equipment Torn reveals on manually viewed attack pages.
// @downloadURL  https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-intel/Kraken-Intel.user.js
// @updateURL    https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-intel/Kraken-Intel.user.js
// @match        https://www.torn.com/page.php*
// @match        https://www.torn.com/profiles.php*
// @connect      igiyqcgpwonbbjdnvxwd.supabase.co
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const SCRIPT = "Kraken Intel";
    const VERSION = "0.5.0";
    const SUPABASE_URL = "https://igiyqcgpwonbbjdnvxwd.supabase.co";
    const SUPABASE_KEY = "sb_publishable_GE2jnNatcy9lopAx1WGujA_06d_yPHd";
    const STORAGE_KEY = "kraken_intel_local_captures_v1";
    const CONSENT_KEY = "kraken_intel_sharing_consent_v1";
    const AUTH_STORAGE_KEY = "kraken_intel_supabase_session_v1";
    const MAX_LOCAL_CAPTURES = 200;
    const SYNC_INTERVAL_MS = 60e3;
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
        latest: null,
        syncTimer: null,
        syncing: false,
        noDataNoticeShown: false,
        hideTimer: null,
        profilePlacementObserver: null
    };

    function showPanel() {
        if (state.hideTimer !== null) W.clearTimeout(state.hideTimer);
        state.hideTimer = null;
        if (state.panel) state.panel.hidden = false;
    }

    function hideEmptyPanelSoon(delay = 2200) {
        if (state.hideTimer !== null) W.clearTimeout(state.hideTimer);
        state.hideTimer = W.setTimeout(() => {
            state.hideTimer = null;
            if (!state.latest && sharingEnabled() && state.panel) state.panel.hidden = true;
        }, delay);
    }

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

    function sharingEnabled() {
        return readValue(CONSENT_KEY, false) === true;
    }

    function parseJson(text) {
        try {
            return JSON.parse(text || "null");
        } catch {
            return null;
        }
    }

    function httpRequest(method, path, { body = null, accessToken = null } = {}) {
        const url = `${SUPABASE_URL}${path}`;
        const headers = {
            apikey: SUPABASE_KEY,
            Accept: "application/json"
        };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        if (body !== null) headers["Content-Type"] = "application/json";
        const encoded = body === null ? null : JSON.stringify(body);
        const wrap = (status, text) => ({
            ok: status >= 200 && status < 300,
            status,
            data: parseJson(text)
        });

        if (typeof W.PDA_httpGet === "function") {
            return (async () => {
                let result;
                if (method === "POST" && typeof W.PDA_httpPost === "function") {
                    result = await W.PDA_httpPost(url, headers, encoded || "");
                } else {
                    result = await W.PDA_httpGet(url, headers);
                }
                return wrap(Number(result?.status || 0), String(result?.responseText || ""));
            })().catch(() => wrap(0, ""));
        }

        if (typeof GM_xmlhttpRequest === "function") {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method,
                    url,
                    headers,
                    ...(encoded === null ? {} : { data: encoded }),
                    timeout: 12e3,
                    onload: (result) => resolve(wrap(result.status, result.responseText)),
                    onerror: () => resolve(wrap(0, "")),
                    ontimeout: () => resolve(wrap(0, ""))
                });
            });
        }

        return W.fetch(url, {
            method,
            headers,
            ...(encoded === null ? {} : { body: encoded })
        }).then(async (response) => wrap(response.status, await response.text()))
            .catch(() => wrap(0, ""));
    }

    function normalizedSession(raw) {
        if (objectRecord(raw?.session)) raw = raw.session;
        if (!objectRecord(raw) || typeof raw.access_token !== "string" || typeof raw.refresh_token !== "string") return null;
        const reportedExpiry = Number(raw.expires_at);
        const expiresAt = reportedExpiry
            ? (reportedExpiry < 1e12 ? reportedExpiry * 1e3 : reportedExpiry)
            : Date.now() + Number(raw.expires_in || 3600) * 1e3;
        return {
            access_token: raw.access_token,
            refresh_token: raw.refresh_token,
            expires_at: expiresAt
        };
    }

    async function authenticatedSession() {
        let session = normalizedSession(readValue(AUTH_STORAGE_KEY, null));
        if (session && session.expires_at > Date.now() + 60e3) return session;

        if (session?.refresh_token) {
            const refreshed = await httpRequest("POST", "/auth/v1/token?grant_type=refresh_token", {
                body: { refresh_token: session.refresh_token }
            });
            const next = refreshed.ok ? normalizedSession(refreshed.data) : null;
            if (next) {
                writeValue(AUTH_STORAGE_KEY, next);
                return next;
            }
        }

        const created = await httpRequest("POST", "/auth/v1/signup", { body: { data: {} } });
        const next = created.ok ? normalizedSession(created.data) : null;
        if (!next) throw new Error(created.data?.msg || created.data?.message || "Anonymous connection failed");
        writeValue(AUTH_STORAGE_KEY, next);
        return next;
    }

    async function sha256(value) {
        const bytes = new TextEncoder().encode(value);
        const digest = await W.crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

    function finiteItemNumber(...values) {
        for (const value of values) {
            if (value === null || value === undefined || value === "") continue;
            const match = typeof value === "string" ? value.trim().match(/^-?\d+(?:\.\d+)?/) : null;
            const number = match ? Number(match[0]) : Number(value);
            if (Number.isFinite(number)) return number;
        }
        return null;
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
            damage: finiteItemNumber(item.dmg, item.damage),
            accuracy: finiteItemNumber(item.acc, item.accuracy),
            armour: finiteItemNumber(item.armor, item.armour, item.def, item.defence, item.defense, item.stats?.armor, item.stats?.defence),
            quality: finiteItemNumber(item.quality, item.qualityPercentage, item.quality_percent, item.itemQuality, item.stats?.quality),
            rarity: typeof item.rarity === "string" && item.rarity.trim()
                ? item.rarity.trim().slice(0, 24)
                : null,
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
            schema_version: 2,
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

    function observationConfidence(observedAt) {
        const ageHours = (Date.now() - Date.parse(observedAt)) / 36e5;
        if (!Number.isFinite(ageHours) || ageHours < 0) return { key: "unknown", label: "Unknown age" };
        if (ageHours < 1) return { key: "high", label: "High confidence" };
        if (ageHours < 12) return { key: "medium", label: "Medium confidence" };
        if (ageHours < 72) return { key: "low", label: "Low confidence" };
        return { key: "stale", label: "Stale intel" };
    }

    function sharedRowToCapture(row) {
        if (!objectRecord(row) || !positiveInteger(row.target_id) || !Array.isArray(row.items)) return null;
        return {
            schema_version: positiveInteger(row.schema_version) || 1,
            target_id: Number(row.target_id),
            target_name: typeof row.target_name === "string" ? row.target_name : null,
            observed_at: row.observed_at,
            fight_id: positiveInteger(row.fight_id),
            attack_status: typeof row.attack_status === "string" ? row.attack_status : null,
            items: row.items,
            source: "shared"
        };
    }

    async function fetchSharedCapture(targetId) {
        if (!sharingEnabled() || !targetId) return null;
        const session = await authenticatedSession();
        const query = new URLSearchParams({
            target_id: `eq.${targetId}`,
            select: "target_id,target_name,observed_at,fight_id,attack_status,items,schema_version",
            limit: "1"
        });
        const response = await httpRequest("GET", `/rest/v1/ki_public_loadouts?${query}`, {
            accessToken: session.access_token
        });
        if (!response.ok) throw new Error(response.data?.message || `Shared lookup failed (${response.status})`);
        return sharedRowToCapture(Array.isArray(response.data) ? response.data[0] : null);
    }

    async function uploadSharedCapture(capture) {
        if (!sharingEnabled()) return false;
        const session = await authenticatedSession();
        const fingerprint = await sha256(JSON.stringify(capture.items));
        const response = await httpRequest("POST", "/rest/v1/rpc/ki_submit_public_loadout", {
            accessToken: session.access_token,
            body: {
                p_target_id: capture.target_id,
                p_target_name: capture.target_name,
                p_observed_at: capture.observed_at,
                p_fingerprint: fingerprint,
                p_fight_id: capture.fight_id,
                p_attack_status: capture.attack_status,
                p_items: capture.items,
                p_schema_version: capture.schema_version
            }
        });
        if (!response.ok) throw new Error(response.data?.message || `Shared upload failed (${response.status})`);
        return true;
    }

    async function syncSharedIntel({ quiet = false } = {}) {
        if (!sharingEnabled() || state.syncing || !currentTargetId() || W.document.visibilityState !== "visible") return;
        state.syncing = true;
        try {
            const shared = await fetchSharedCapture(currentTargetId());
            if (shared && (!state.latest || Date.parse(shared.observed_at) > Date.parse(state.latest.observed_at))) {
                state.latest = shared;
                saveCapture(shared);
            }
            if (shared) {
                showPanel();
                state.status = "";
            }
            if (!quiet) {
                if (!shared && !state.latest) state.status = "No shared loadout has been observed for this player yet.";
                renderPanel();
                if (!shared && !state.latest) hideEmptyPanelSoon(3000);
            } else if (shared) {
                renderPanel();
            }
        } catch (error) {
            if (!quiet && !state.latest) {
                state.status = `Shared connection unavailable: ${error.message}`;
                showPanel();
                renderPanel();
                hideEmptyPanelSoon(3000);
            }
            console.warn(`[${SCRIPT}] Shared sync failed`, error);
        } finally {
            state.syncing = false;
        }
    }

    function startSharedSync() {
        if (state.syncTimer !== null) W.clearInterval(state.syncTimer);
        if (!sharingEnabled()) return;
        state.syncTimer = W.setInterval(() => syncSharedIntel({ quiet: true }), SYNC_INTERVAL_MS);
        syncSharedIntel();
    }

    function itemSummary(item) {
        const details = [];
        const armourSlot = [4, 6, 7, 8, 9].includes(Number(item.equip_slot));
        if (armourSlot) {
            if (item.armour !== null && item.armour !== undefined) details.push(`ARM ${item.armour}`);
        } else {
            if (item.damage !== null && item.damage !== undefined) details.push(`DMG ${item.damage}`);
            if (item.accuracy !== null && item.accuracy !== undefined) details.push(`ACC ${item.accuracy}`);
        }
        if (item.quality !== null && item.quality !== undefined) details.push(`Quality ${item.quality}%`);
        if (item.rarity) details.push(String(item.rarity));
        for (const bonus of Array.isArray(item.bonuses) ? item.bonuses : []) {
            details.push(bonus.value === null ? bonus.name : `${bonus.name} ${bonus.value}%`);
        }
        return details.join(" · ");
    }

    function renderPanel() {
        if (!state.body) return;
        state.body.replaceChildren();

        if (pageDetails().type === "attack" && state.latest) {
            state.panel.hidden = true;
            return;
        }

        if (!sharingEnabled()) {
            const consent = W.document.createElement("div");
            consent.className = "ki-consent";
            const copy = W.document.createElement("p");
            copy.textContent = "Kraken Intel collaboratively shares equipment Torn reveals on attack pages you actively view, together with the target ID and observation time. It does not automate attacks or store a Torn API key.";
            const enable = W.document.createElement("button");
            enable.type = "button";
            enable.className = "ki-enable";
            enable.textContent = "Enable shared intel";
            enable.addEventListener("click", () => {
                writeValue(CONSENT_KEY, true);
                state.status = "Connecting to the shared Kraken Intel network…";
                renderPanel();
                startSharedSync();
            });
            consent.append(copy, enable);
            state.body.appendChild(consent);
        }

        if (state.status) {
            const status = W.document.createElement("div");
            status.className = "ki-status";
            status.textContent = state.status;
            state.body.appendChild(status);
        }

        if (!state.latest) return;
        const meta = W.document.createElement("div");
        meta.className = "ki-meta";
        const confidence = observationConfidence(state.latest.observed_at);
        const target = state.latest.target_name
            ? `${state.latest.target_name} [${state.latest.target_id}]`
            : `Player ${state.latest.target_id}`;
        const identity = W.document.createElement("span");
        identity.textContent = `${target} · ${new Date(state.latest.observed_at).toLocaleString()}`;
        const badge = W.document.createElement("span");
        badge.className = `ki-confidence is-${confidence.key}`;
        badge.textContent = confidence.label;
        meta.append(identity, badge);
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
        note.textContent = sharingEnabled()
            ? "Shared automatically with the Kraken Intel contributor network. Newer observations take priority."
            : "Saved locally on this device; shared uploads are currently disabled.";
        state.body.appendChild(note);
    }

    async function receiveAttackData(data) {
        const capture = buildCapture(data);
        if (!capture) {
            if (!state.latest && !state.noDataNoticeShown && currentTargetId() && visibleAndFocused()) {
                state.noDataNoticeShown = true;
                state.status = "Attack data received, but Torn has not revealed a usable loadout.";
                showPanel();
                renderPanel();
                hideEmptyPanelSoon();
            }
            return;
        }
        showPanel();
        saveCapture(capture);
        state.latest = capture;
        state.status = "";
        renderPanel();
        W.document.dispatchEvent(new CustomEvent("kraken-intel:capture", { detail: capture }));
        console.info(`[${SCRIPT}] Captured loadout for ${capture.target_id}`, capture);
        if (!sharingEnabled()) return;
        try {
            await uploadSharedCapture(capture);
        } catch (error) {
            console.warn(`[${SCRIPT}] Shared upload failed`, error);
        }
    }

    function attackItemContainer(item) {
        const currentBonuses = {};
        for (const [index, bonus] of (Array.isArray(item.bonuses) ? item.bonuses : []).entries()) {
            currentBonuses[index] = { title: bonus.name, value: bonus.value };
        }
        return { item: [{
            ID: item.item_id,
            armouryID: item.armoury_id,
            equipSlot: item.equip_slot,
            name: item.name,
            dmg: item.damage,
            acc: item.accuracy,
            armor: item.armour,
            def: item.armour,
            quality: item.quality,
            rarity: item.rarity,
            currentBonuses
        }] };
    }

    function patchAttackData(data, intel) {
        const db = objectRecord(data?.DB) ? data.DB : data;
        if (!objectRecord(db) || positiveInteger(db.defenderUser?.userID) !== intel.target_id) return data;
        const nativeItems = objectRecord(db.defenderItems) ? db.defenderItems : {};
        if (extractItems(nativeItems).some((item) => item.item_id !== 999)) return data;

        const defenderItems = {};
        for (const [key, container] of Object.entries(nativeItems)) {
            const nativeItem = firstItem(container);
            if ([999, 1000].includes(Number(nativeItem?.ID))) defenderItems[key] = container;
        }
        for (const item of intel.items || []) {
            if (!positiveInteger(item.item_id) || !COMBAT_SLOTS.has(Number(item.equip_slot))) continue;
            defenderItems[String(item.equip_slot)] = attackItemContainer(item);
        }
        if (!Object.keys(defenderItems).length) return data;

        const patchedDb = { ...db, defenderItems, showEnemyItems: true };
        return data.DB ? { ...data, DB: patchedDb } : patchedDb;
    }

    async function prepareAttackResponse(response) {
        let data;
        try {
            data = await response.clone().json();
        } catch (error) {
            console.warn(`[${SCRIPT}] Could not read attack response`, error);
            return response;
        }
        if (!objectRecord(data)) return response;

        const capture = buildCapture(data);
        if (capture) {
            receiveAttackData(data).catch((error) => console.warn(`[${SCRIPT}] Could not process attack response`, error));
            return response;
        }

        if (!state.latest && sharingEnabled()) {
            try {
                const shared = await fetchSharedCapture(currentTargetId());
                if (shared) {
                    state.latest = shared;
                    state.status = "";
                    saveCapture(shared);
                    renderPanel();
                }
            } catch (error) {
                console.warn(`[${SCRIPT}] Could not load attack intel`, error);
            }
        }

        if (!state.latest) {
            receiveAttackData(data).catch((error) => console.warn(`[${SCRIPT}] Could not process attack response`, error));
            return response;
        }

        const patched = patchAttackData(data, state.latest);
        if (patched === data) return response;
        try {
            return new W.Response(JSON.stringify(patched), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
        } catch (error) {
            console.warn(`[${SCRIPT}] Could not reveal saved equipment in Torn's attack display`, error);
            return response;
        }
    }

    function installFetchObserver() {
        const originalFetch = W.fetch;
        if (typeof originalFetch !== "function" || originalFetch.__krakenIntelWrapped) return;

        function krakenIntelFetch(...args) {
            const result = Reflect.apply(originalFetch, this, args);
            if (!isAttackDataRequest(args[0])) return result;
            return result.then((response) => {
                if (!response?.ok) return response;
                return prepareAttackResponse(response);
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
            #kraken-intel-panel .ki-meta{border-top:1px solid #ffffff17;color:#aab8bc;font-size:10px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px}
            #kraken-intel-panel .ki-confidence{border-radius:10px;padding:2px 7px;font-size:9px;font-weight:700;color:#10171b}
            #kraken-intel-panel .ki-confidence.is-high{background:#63d786}
            #kraken-intel-panel .ki-confidence.is-medium{background:#f0c45a}
            #kraken-intel-panel .ki-confidence.is-low{background:#ec726e}
            #kraken-intel-panel .ki-confidence.is-stale,#kraken-intel-panel .ki-confidence.is-unknown{background:#879397}
            #kraken-intel-panel .ki-row{display:grid;grid-template-columns:52px 72px minmax(0,1fr);align-items:center;gap:7px;padding:7px 10px;border-top:1px solid #ffffff12}
            #kraken-intel-panel .ki-image-wrap{display:flex;width:50px;height:34px;align-items:center;justify-content:center;border-radius:5px;background:#ffffff0b;overflow:hidden}
            #kraken-intel-panel .ki-image-wrap.is-missing:after{content:"?";color:#60757a;font-weight:700}
            #kraken-intel-panel .ki-image-wrap.is-missing .ki-image{display:none}
            #kraken-intel-panel .ki-image{display:block;max-width:50px;max-height:34px;object-fit:contain}
            #kraken-intel-panel .ki-slot{color:#67cbd4;font-weight:700}
            #kraken-intel-panel .ki-item{display:flex;min-width:0;flex-direction:column}
            #kraken-intel-panel[hidden]{display:none!important}
            #kraken-intel-panel .ki-item strong{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
            #kraken-intel-panel .ki-item small{color:#aab8bc;white-space:normal}
            #kraken-intel-panel .ki-note{border-top:1px solid #ffffff17;color:#7f9297;font-size:10px}
            #kraken-intel-panel .ki-consent{padding:10px;border-bottom:1px solid #ffffff17;background:#123037}
            #kraken-intel-panel .ki-consent p{margin:0 0 9px;color:#cfdee0;font-size:10px;line-height:1.4}
            #kraken-intel-panel .ki-enable{border:1px solid #49c5d0;background:#177d86;color:#fff;border-radius:5px;padding:6px 9px;font:700 11px Arial,sans-serif;cursor:pointer}
            #kraken-intel-panel.ki-profile-inline{position:static;z-index:auto;width:100%;max-width:none;margin:10px 0 0;border-color:#177d86;box-shadow:none}
            #kraken-intel-panel.ki-profile-inline .ki-body{max-height:none}
        `;
        (W.document.head || W.document.documentElement).appendChild(style);
    }

    function profileActionsPanel() {
        const headings = W.document.querySelectorAll(
            ".profile-wrapper .title-black, #profileroot [class*='title'], .user-profile [class*='title']"
        );
        for (const heading of headings) {
            if (heading.textContent?.trim().toLowerCase() !== "actions") continue;
            return heading.closest(".profile-wrapper") || heading.parentElement;
        }
        return null;
    }

    function placeProfilePanel(panel) {
        const actions = profileActionsPanel();
        if (!actions?.parentElement) return false;
        if (actions.nextElementSibling !== panel) actions.after(panel);
        return true;
    }

    function maintainProfilePanelPlacement(panel) {
        placeProfilePanel(panel);
        state.profilePlacementObserver?.disconnect();
        state.profilePlacementObserver = new MutationObserver(() => {
            if (!panel.isConnected) {
                state.profilePlacementObserver?.disconnect();
                state.profilePlacementObserver = null;
                return;
            }
            placeProfilePanel(panel);
        });
        state.profilePlacementObserver.observe(W.document.body, { childList: true, subtree: true });
    }

    function mountPanel() {
        if (!currentTargetId() || !W.document.body || state.panel?.isConnected) return;
        const panel = W.document.createElement("section");
        panel.id = "kraken-intel-panel";
        panel.classList.remove("is-collapsed");

        const head = W.document.createElement("button");
        head.type = "button";
        head.className = "ki-head";
        const title = W.document.createElement("span");
        title.textContent = "🐙 Kraken Intel";
        const version = W.document.createElement("span");
        version.className = "ki-version";
        version.textContent = `Shared intel v${VERSION}`;
        head.append(title, version);
        head.addEventListener("click", () => {
            const next = !panel.classList.contains("is-collapsed");
            panel.classList.toggle("is-collapsed", next);
        });

        const body = W.document.createElement("div");
        body.className = "ki-body";
        panel.append(head, body);
        if (pageDetails().type === "profile") panel.classList.add("ki-profile-inline");
        W.document.body.appendChild(panel);
        state.panel = panel;
        state.body = body;
        if (pageDetails().type === "attack") panel.hidden = true;
        if (pageDetails().type === "profile") maintainProfilePanelPlacement(panel);
        renderPanel();
    }

    function onReady() {
        const page = pageDetails();
        const saved = latestStoredCapture(page.targetId);
        if (saved) {
            state.latest = saved;
            state.status = "";
        } else if (page.type === "profile") {
            state.status = "Checking the shared network for this player…";
        }
        mountPanel();
        startSharedSync();
        console.info(`[${SCRIPT}] Loaded shared intel v${VERSION}`);
    }

    if (!currentTargetId() || W.__krakenIntelInstalled) return;
    W.__krakenIntelInstalled = true;
    if (pageDetails().type === "attack") installFetchObserver();
    installStyles();
    W.document.addEventListener("visibilitychange", () => {
        if (W.document.visibilityState === "visible" && sharingEnabled()) syncSharedIntel({ quiet: true });
    });
    if (W.document.readyState === "loading") {
        W.document.addEventListener("DOMContentLoaded", onReady, { once: true });
    } else {
        onReady();
    }
})();

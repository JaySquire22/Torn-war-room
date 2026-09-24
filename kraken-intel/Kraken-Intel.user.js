// ==UserScript==
// @name         Kraken Intel
// @namespace    kraken.intel
// @version      0.7.0
// @author       -TheKraken-
// @description  Captures and shares equipment Torn reveals on manually viewed attack pages.
// @downloadURL  https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-intel/Kraken-Intel.user.js
// @updateURL    https://raw.githubusercontent.com/JaySquire22/Torn-war-room/main/kraken-intel/Kraken-Intel.user.js
// @match        https://www.torn.com/page.php*
// @match        https://www.torn.com/profiles.php*
// @connect      igiyqcgpwonbbjdnvxwd.supabase.co
// @connect      api.torn.com
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
    const VERSION = "0.7.0";
    const SUPABASE_URL = "https://igiyqcgpwonbbjdnvxwd.supabase.co";
    const SUPABASE_KEY = "sb_publishable_GE2jnNatcy9lopAx1WGujA_06d_yPHd";
    const STORAGE_KEY = "kraken_intel_local_captures_v1";
    const CONSENT_KEY = "kraken_intel_sharing_consent_v1";
    const AUTH_STORAGE_KEY = "kraken_intel_supabase_session_v1";
    const TORN_API_KEY_STORAGE_KEY = "kraken_intel_torn_api_key_v1";
    const ITEM_DETAILS_CACHE_KEY = "kraken_intel_item_details_cache_v1";
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
        profilePlacementObserver: null,
        attackLayoutObserver: null,
        attackRenderFrame: null,
        enriching: false
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

    function storedTornApiKey() {
        const value = readValue(TORN_API_KEY_STORAGE_KEY, "");
        return typeof value === "string" ? value.trim() : "";
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

    function externalJsonRequest(url) {
        const wrap = (status, text) => ({
            ok: status >= 200 && status < 300,
            status,
            data: parseJson(text)
        });
        if (typeof W.PDA_httpGet === "function") {
            return W.PDA_httpGet(url, { Accept: "application/json" })
                .then((result) => wrap(Number(result?.status || 0), String(result?.responseText || "")))
                .catch(() => wrap(0, ""));
        }
        if (typeof GM_xmlhttpRequest === "function") {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url,
                    headers: { Accept: "application/json" },
                    timeout: 12e3,
                    onload: (result) => resolve(wrap(result.status, result.responseText)),
                    onerror: () => resolve(wrap(0, "")),
                    ontimeout: () => resolve(wrap(0, ""))
                });
            });
        }
        return W.fetch(url, { headers: { Accept: "application/json" } })
            .then(async (response) => wrap(response.status, await response.text()))
            .catch(() => wrap(0, ""));
    }

    function tornApiError(response, fallback = "Torn API request failed") {
        const error = response?.data?.error;
        const message = typeof error?.error === "string"
            ? error.error
            : typeof error === "string"
                ? error
                : typeof response?.data?.message === "string"
                    ? response.data.message
                    : null;
        return message || (response?.status ? `${fallback} (HTTP ${response.status})` : `${fallback}: connection unavailable`);
    }

    async function tornApiRequest(path, key = storedTornApiKey()) {
        if (!key) throw new Error("No Torn API key is saved");
        const url = new URL(`https://api.torn.com${path}`);
        url.searchParams.set("key", key);
        url.searchParams.set("comment", "Kraken-Intel");
        const response = await externalJsonRequest(url.href);
        if (!response.ok || response.data?.error) throw new Error(tornApiError(response));
        return response.data;
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

    function nestedValues(root, wantedKeys, maxDepth = 4) {
        const wanted = new Set(wantedKeys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
        const found = [];
        const seen = new Set();
        const visit = (value, depth) => {
            if (!objectRecord(value) && !Array.isArray(value) || seen.has(value) || depth > maxDepth) return;
            seen.add(value);
            for (const [key, child] of Object.entries(value)) {
                const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
                if (wanted.has(normalizedKey)) found.push(child);
                if (objectRecord(child) || Array.isArray(child)) visit(child, depth + 1);
            }
        };
        visit(root, 0);
        return found;
    }

    function normalizeBonuses(...sources) {
        const bonusContainers = sources.flatMap((source) => nestedValues(source, ["currentBonuses", "bonuses", "bonus"]));
        return bonusContainers.flatMap((container) => {
            const values = Array.isArray(container) ? container : objectRecord(container) ? Object.values(container) : [];
            return values.flatMap((raw) => {
            if (!objectRecord(raw)) return [];
            const name = String(raw.title || raw.name || "Bonus").slice(0, 60);
            const numeric = finiteItemNumber(raw.value, raw.percentage, raw.percent, raw.proc);
            return [{ name, value: Number.isFinite(numeric) ? numeric : null }];
            });
        }).filter((bonus, index, all) => all.findIndex((candidate) => candidate.name === bonus.name && candidate.value === bonus.value) === index).slice(0, 2);
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

    function nestedItemNumber(sources, keys) {
        return finiteItemNumber(...sources.flatMap((source) => nestedValues(source, keys)));
    }

    function equipmentSnapshot(value, depth = 0, seen = new WeakSet()) {
        if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
        if (typeof value !== "object" || depth > 6 || seen.has(value)) return null;
        seen.add(value);
        if (Array.isArray(value)) return value.slice(0, 24).map((entry) => equipmentSnapshot(entry, depth + 1, seen));
        const snapshot = {};
        for (const [key, child] of Object.entries(value).slice(0, 100)) {
            if (/token|cookie|authorization|api.?key|attackeruser/i.test(key)) continue;
            const safe = equipmentSnapshot(child, depth + 1, seen);
            if (safe !== null) snapshot[key] = safe;
        }
        return snapshot;
    }

    function normalizeItem(item, container = null) {
        const equipSlot = Number(item.equipSlot);
        if (!COMBAT_SLOTS.has(equipSlot) && Number(item.ID) !== 999) return null;
        const sources = [item, container].filter(Boolean);
        return {
            item_id: positiveInteger(item.ID),
            armoury_id: positiveInteger(item.armouryID ?? item.armoryID),
            equip_slot: equipSlot,
            slot_name: Number(item.ID) === 999 ? "Unarmed" : COMBAT_SLOTS.get(equipSlot),
            name: String(item.name || `Item #${item.ID || "unknown"}`).slice(0, 100),
            image_url: itemImageUrl(item),
            damage: finiteItemNumber(item.dmg, item.damage),
            accuracy: finiteItemNumber(item.acc, item.accuracy),
            armour: nestedItemNumber(sources, ["armor", "armour", "arm", "def", "defence", "defense", "armorRating", "armourRating", "rating"]),
            quality: nestedItemNumber(sources, ["quality", "qualityPercentage", "qualityPercent", "itemQuality"]),
            rarity: typeof item.rarity === "string" && item.rarity.trim()
                ? item.rarity.trim().slice(0, 24)
                : null,
            bonuses: normalizeBonuses(item, container),
            raw_source: container ? equipmentSnapshot(container) : null
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
            const normalized = item ? normalizeItem(item, container) : null;
            return normalized ? [normalized] : [];
        });
    }

    function itemDetailRecords(value, records = [], depth = 0) {
        if (depth > 5 || value === null || typeof value !== "object") return records;
        if (Array.isArray(value)) {
            for (const entry of value) itemDetailRecords(entry, records, depth + 1);
            return records;
        }
        const uid = positiveInteger(value.uid ?? value.UID ?? value.armouryID ?? value.armoryID);
        if (uid && (objectRecord(value.stats) || Array.isArray(value.bonuses) || value.quality !== undefined)) {
            records.push(value);
            return records;
        }
        for (const child of Object.values(value)) itemDetailRecords(child, records, depth + 1);
        return records;
    }

    function normalizedApiItemDetails(raw) {
        if (!objectRecord(raw)) return null;
        const stats = objectRecord(raw.stats) ? raw.stats : raw;
        const armour = finiteItemNumber(stats.armor, stats.armour, raw.armor, raw.armour);
        const quality = finiteItemNumber(stats.quality, raw.quality);
        const bonuses = normalizeBonuses(raw);
        const rarity = typeof raw.rarity === "string" && raw.rarity.trim() ? raw.rarity.trim().slice(0, 24) : null;
        if (armour === null && quality === null && !bonuses.length && !rarity) return null;
        return { armour, quality, bonuses, rarity, fetched_at: new Date().toISOString() };
    }

    function cachedItemDetails() {
        const stored = readValue(ITEM_DETAILS_CACHE_KEY, {});
        return objectRecord(stored) ? stored : {};
    }

    async function fetchUniqueItemDetails(uids) {
        const unique = [...new Set(uids.map(positiveInteger).filter(Boolean))];
        if (!unique.length || !storedTornApiKey()) return new Map();
        const cache = cachedItemDetails();
        const found = new Map();
        const missing = [];
        for (const uid of unique) {
            const cached = objectRecord(cache[uid]) ? cache[uid] : null;
            if (cached) found.set(uid, cached);
            else missing.push(uid);
        }
        for (let index = 0; index < missing.length; index += 25) {
            const batch = missing.slice(index, index + 25);
            const data = await tornApiRequest(`/v2/torn/${batch.join(",")}/itemdetails`);
            for (const record of itemDetailRecords(data)) {
                const uid = positiveInteger(record.uid ?? record.UID ?? record.armouryID ?? record.armoryID);
                const normalized = normalizedApiItemDetails(record);
                if (!uid || !normalized || !unique.includes(uid)) continue;
                cache[uid] = normalized;
                found.set(uid, normalized);
            }
        }
        const trimmed = Object.fromEntries(Object.entries(cache).slice(-500));
        writeValue(ITEM_DETAILS_CACHE_KEY, trimmed);
        return found;
    }

    async function enrichCaptureWithTornApi(capture) {
        if (!capture?.items || !storedTornApiKey()) return capture;
        const armour = capture.items.filter((item) => isArmourSlot(item) && positiveInteger(item.armoury_id));
        if (!armour.length) return capture;
        const details = await fetchUniqueItemDetails(armour.map((item) => item.armoury_id));
        if (!details.size) return capture;
        return {
            ...capture,
            items: capture.items.map((item) => {
                const detail = details.get(positiveInteger(item.armoury_id));
                if (!detail) return item;
                return {
                    ...item,
                    armour: detail.armour ?? item.armour,
                    quality: detail.quality ?? item.quality,
                    rarity: detail.rarity || item.rarity,
                    bonuses: detail.bonuses?.length ? detail.bonuses : item.bonuses,
                    detail_source: "torn-api-itemdetails"
                };
            })
        };
    }

    async function refreshLatestArmourDetails() {
        if (!state.latest || !storedTornApiKey() || state.enriching) return state.latest;
        const current = state.latest;
        state.enriching = true;
        try {
            const enriched = await enrichCaptureWithTornApi(current);
            if (state.latest === current) {
                state.latest = enriched;
                saveCapture(enriched);
                renderPanel();
            }
            return enriched;
        } catch (error) {
            console.warn(`[${SCRIPT}] Torn API armour lookup failed`, error);
            return current;
        } finally {
            state.enriching = false;
        }
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
            schema_version: 3,
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
        const items = row.items.map((item) => {
            if (!objectRecord(item?.raw_source)) return item;
            const rawItem = firstItem(item.raw_source);
            const refreshed = rawItem ? normalizeItem(rawItem, item.raw_source) : null;
            return refreshed ? { ...item, ...refreshed } : item;
        });
        return {
            schema_version: positiveInteger(row.schema_version) || 1,
            target_id: Number(row.target_id),
            target_name: typeof row.target_name === "string" ? row.target_name : null,
            observed_at: row.observed_at,
            fight_id: positiveInteger(row.fight_id),
            attack_status: typeof row.attack_status === "string" ? row.attack_status : null,
            items,
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
        const armourSlot = isArmourSlot(item);
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

    function isArmourSlot(item) {
        return [4, 6, 7, 8, 9].includes(Number(item?.equip_slot));
    }

    function appendTornApiSettings(parent) {
        if (pageDetails().type !== "profile") return;
        const savedKey = storedTornApiKey();
        const settings = W.document.createElement("details");
        settings.className = "ki-api-settings";
        const summary = W.document.createElement("summary");
        summary.textContent = savedKey ? "Torn API connected" : "Connect Torn API";
        const copy = W.document.createElement("p");
        copy.textContent = "Used to request exact armour details from Torn when the captured unique item ID is available. The key stays in this device's userscript storage and is never uploaded to Kraken Intel.";
        const input = W.document.createElement("input");
        input.type = "password";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = savedKey ? "Enter a replacement key" : "Enter Torn API key";
        input.setAttribute("aria-label", "Torn API key");
        const actions = W.document.createElement("div");
        actions.className = "ki-api-actions";
        const save = W.document.createElement("button");
        save.type = "button";
        save.textContent = savedKey ? "Replace key" : "Save key";
        const feedback = W.document.createElement("span");
        feedback.className = "ki-api-feedback";
        save.addEventListener("click", async () => {
            const key = input.value.trim();
            if (!key) {
                feedback.textContent = "Enter an API key first.";
                feedback.classList.add("is-error");
                return;
            }
            save.disabled = true;
            save.textContent = "Checking…";
            feedback.textContent = "";
            feedback.classList.remove("is-error");
            try {
                await tornApiRequest("/v2/key/info", key);
                writeValue(TORN_API_KEY_STORAGE_KEY, key);
                input.value = "";
                summary.textContent = "Torn API connected";
                save.textContent = "Saved";
                feedback.textContent = "Key verified.";
                renderPanel();
                refreshLatestArmourDetails().then((enriched) => {
                    if (sharingEnabled() && enriched) uploadSharedCapture(enriched).catch((error) => console.warn(`[${SCRIPT}] Could not share enriched armour details`, error));
                });
            } catch (error) {
                feedback.textContent = error.message;
                feedback.classList.add("is-error");
                save.disabled = false;
                save.textContent = savedKey ? "Replace key" : "Save key";
            }
        });
        actions.appendChild(save);
        if (savedKey) {
            const remove = W.document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove key";
            remove.addEventListener("click", () => {
                writeValue(TORN_API_KEY_STORAGE_KEY, "");
                renderPanel();
            });
            actions.appendChild(remove);
        }
        settings.append(summary, copy, input, actions, feedback);
        parent.appendChild(settings);
    }

    function renderPanel() {
        if (!state.body) return;
        state.body.replaceChildren();

        if (pageDetails().type === "attack" && state.latest) {
            state.panel.hidden = true;
            scheduleAttackEquipmentRender();
            return;
        }

        if (!sharingEnabled()) {
            const consent = W.document.createElement("div");
            consent.className = "ki-consent";
            const copy = W.document.createElement("p");
            copy.textContent = "Kraken Intel collaboratively shares equipment Torn reveals on attack pages you actively view, together with the target ID and observation time. It does not automate attacks. Any Torn API key you add below remains on this device and is never shared.";
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

        if (!state.latest) {
            appendTornApiSettings(state.body);
            return;
        }
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
            details.textContent = itemSummary(item) || (isArmourSlot(item)
                ? "Rating, quality and bonuses not exposed by Torn"
                : "No additional details supplied");
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
        appendTornApiSettings(state.body);
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
        const enriched = await refreshLatestArmourDetails();
        if (!sharingEnabled()) return;
        try {
            await uploadSharedCapture(enriched || capture);
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

    const ATTACKER_WEAPON_MARKERS = {
        1: ["attacker_Primary", "weapon_main"],
        2: ["attacker_Secondary", "weapon_second"],
        3: ["attacker_Melee", "weapon_melee"],
        5: ["attacker_Temporary", "weapon_temp"]
    };

    const ARMOUR_LABEL_POSITIONS = {
        4: { top: "31%", left: "57%" },
        6: { top: "12%", left: "56%" },
        7: { top: "57%", left: "57%" },
        8: { top: "79%", left: "56%" },
        9: { top: "43%", left: "62%" }
    };

    function attackerWeaponWrapper(slot) {
        for (const id of ATTACKER_WEAPON_MARKERS[slot] || []) {
            const marker = W.document.getElementById(id);
            if (!marker) continue;
            return marker.matches("[class*='weaponWrapper']")
                ? marker
                : marker.closest("[class*='weaponWrapper']") || marker;
        }
        const slotIndex = new Map([[1, 0], [2, 1], [3, 2], [5, 3]]).get(Number(slot));
        if (slotIndex === undefined) return null;
        const candidates = [...W.document.querySelectorAll("#attack-root [class*='weaponWrapper'], [class*='weaponWrapper']")]
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width >= 70 && rect.height >= 60 && rect.left < W.innerWidth * .32 && rect.bottom > 0 && rect.top < W.innerHeight;
            })
            .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
        return candidates[slotIndex] || null;
    }

    function attackAvatarArea() {
        const defenderModal = W.document.querySelector("[class*='modal'][class*='defender']");
        if (defenderModal) return defenderModal.closest("[class*='playerArea']") || defenderModal.parentElement;
        const areas = [...W.document.querySelectorAll("#attack-root [class*='playerArea'], [class*='playerArea']")];
        if (areas.length) return areas.find((area) => area.querySelector("[class*='defender'], [id*='defender']")) || areas.at(-1);
        return W.document.querySelector("#attack-root [class*='fight'], #attack-root") || null;
    }

    const DEFAULT_WEAPON_POSITIONS = {
        1: { x: 20, y: 12.5 },
        2: { x: 80, y: 12.5 },
        3: { x: 20, y: 90 },
        5: { x: 80, y: 90 }
    };

    function weaponPosition(slot) {
        return DEFAULT_WEAPON_POSITIONS[slot] || { x: 50, y: 50 };
    }

    function attackEquipmentBounds(avatar) {
        const avatarRect = avatar.getBoundingClientRect();
        const weaponRects = [1, 2, 3, 5]
            .map(attackerWeaponWrapper)
            .filter(Boolean)
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
        return {
            left: weaponRects.length ? Math.max(...weaponRects.map((rect) => rect.right)) + 8 : avatarRect.left + 8,
            right: avatarRect.right - 8,
            top: weaponRects.length ? Math.min(...weaponRects.map((rect) => rect.top)) + 8 : avatarRect.top + 8,
            bottom: weaponRects.length ? Math.max(...weaponRects.map((rect) => rect.bottom)) - 8 : avatarRect.bottom - 8
        };
    }

    function positionWeaponLabel(label, position, bounds) {
        label.style.left = `${Math.round(bounds.left + (bounds.right - bounds.left) * position.x / 100)}px`;
        label.style.top = `${Math.round(bounds.top + (bounds.bottom - bounds.top) * position.y / 100)}px`;
        label.dataset.x = String(Math.round(position.x * 10) / 10);
        label.dataset.y = String(Math.round(position.y * 10) / 10);
    }

    function createEnemyWeaponLabel(item, bounds) {
        const label = W.document.createElement("div");
        label.className = "ki-enemy-weapon-label";
        label.dataset.slot = String(item.equip_slot);
        label.title = `${item.slot_name || "Weapon"} — ${item.name}`;

        const image = W.document.createElement("img");
        image.src = item.image_url || `https://www.torn.com/images/items/${item.item_id}/large.png`;
        image.alt = "";
        const copy = W.document.createElement("span");
        copy.className = "ki-enemy-weapon-copy";
        const name = W.document.createElement("strong");
        name.textContent = item.name;
        const damage = W.document.createElement("span");
        damage.textContent = `Dmg ${item.damage ?? "—"}`;
        const accuracy = W.document.createElement("span");
        accuracy.textContent = `Acc ${item.accuracy ?? "—"}`;
        copy.append(name, damage, accuracy);
        label.append(copy, image);

        positionWeaponLabel(label, weaponPosition(item.equip_slot), bounds);
        return label;
    }

    function renderAttackEquipment() {
        state.attackRenderFrame = null;
        W.document.querySelectorAll(".ki-enemy-weapons-layer,.ki-enemy-weapons-column,.ki-enemy-weapon-card,.ki-enemy-weapon-label,.ki-calibration-control,.ki-armour-stat-label").forEach((node) => node.remove());
        W.document.querySelectorAll(".ki-attack-weapon-host").forEach((node) => node.classList.remove("ki-attack-weapon-host"));
        W.document.querySelectorAll(".ki-attack-avatar-host").forEach((node) => node.classList.remove("ki-attack-avatar-host"));
        W.document.documentElement.classList.toggle("ki-loadout-revealed", pageDetails().type === "attack" && Boolean(state.latest));
        if (pageDetails().type !== "attack" || !state.latest?.items) return;

        const avatar = attackAvatarArea();
        if (!avatar) return;
        avatar.classList.add("ki-attack-avatar-host");
        const bounds = attackEquipmentBounds(avatar);
        const weaponItems = state.latest.items.filter((item) => DEFAULT_WEAPON_POSITIONS[Number(item.equip_slot)]);
        if (weaponItems.length && bounds.right > bounds.left && bounds.bottom > bounds.top) {
            const layer = W.document.createElement("div");
            layer.className = "ki-enemy-weapons-layer";
            for (const item of weaponItems) layer.appendChild(createEnemyWeaponLabel(item, bounds));
            W.document.body.appendChild(layer);
        }
        for (const item of state.latest.items) {
            const position = ARMOUR_LABEL_POSITIONS[Number(item.equip_slot)];
            const details = position ? itemSummary(item) : "";
            if (!position || !details) continue;
            const label = W.document.createElement("div");
            label.className = "ki-armour-stat-label";
            label.style.top = position.top;
            label.style.left = position.left;
            const name = W.document.createElement("strong");
            name.textContent = item.name;
            const stats = W.document.createElement("span");
            stats.textContent = details;
            label.append(name, stats);
            avatar.appendChild(label);
        }
    }

    function scheduleAttackEquipmentRender() {
        if (state.attackRenderFrame !== null || pageDetails().type !== "attack") return;
        state.attackRenderFrame = W.requestAnimationFrame(renderAttackEquipment);
    }

    function observeAttackLayout() {
        if (state.attackLayoutObserver || !W.document.body) return;
        state.attackLayoutObserver = new MutationObserver((records) => {
            const changed = records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) =>
                !(node instanceof W.Element) || !node.matches?.(".ki-enemy-weapons-layer,.ki-enemy-weapons-column,.ki-enemy-weapon-card,.ki-enemy-weapon-label,.ki-calibration-control,.ki-armour-stat-label")
            ));
            if (changed) scheduleAttackEquipmentRender();
        });
        state.attackLayoutObserver.observe(W.document.body, { childList: true, subtree: true });
        scheduleAttackEquipmentRender();
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
            #kraken-intel-panel .ki-api-settings{border-top:1px solid #ffffff17;padding:8px 10px;color:#aab8bc}
            #kraken-intel-panel .ki-api-settings summary{color:var(--default-color,#e9f3f4);cursor:pointer;font-weight:700}
            #kraken-intel-panel .ki-api-settings p{margin:7px 0;font-size:10px;line-height:1.4}
            #kraken-intel-panel .ki-api-settings input{box-sizing:border-box;width:100%;border:1px solid var(--panel-divider-outer-side-color,#60757a);border-radius:4px;background:var(--default-bg-panel-color,#20282b);color:var(--default-color,#eee);padding:7px;font:11px Arial,sans-serif}
            #kraken-intel-panel .ki-api-actions{display:flex;gap:6px;margin-top:7px}
            #kraken-intel-panel .ki-api-actions button{border:1px solid var(--panel-divider-outer-side-color,#60757a);border-radius:4px;background:var(--default-bg-panel-color,#343d40);color:var(--default-color,#eee);padding:5px 8px;font:700 10px Arial,sans-serif;cursor:pointer}
            #kraken-intel-panel .ki-api-actions button:disabled{cursor:default;opacity:.6}
            #kraken-intel-panel .ki-api-feedback{display:block;margin-top:6px;font-size:10px;color:#73d7a0}
            #kraken-intel-panel .ki-api-feedback.is-error{color:#ec726e}
            #kraken-intel-panel.ki-profile-inline{position:static;z-index:auto;width:100%;max-width:none;margin:10px 0 0;border-color:#177d86;box-shadow:none}
            #kraken-intel-panel.ki-profile-inline .ki-body{max-height:none}
            #kraken-intel-panel.ki-profile-inline{border-color:var(--panel-divider-outer-side-color,#555);background:var(--default-bg-panel-color,#2f2f2f);color:var(--default-color,#ddd);border-radius:5px}
            #kraken-intel-panel.ki-profile-inline .ki-head{background:linear-gradient(180deg,#666,#3b3b3b);color:var(--default-color,#eee);min-height:38px;padding:8px 12px}
            #kraken-intel-panel.ki-profile-inline .ki-body{background:var(--default-bg-panel-color,#2f2f2f)}
            #kraken-intel-panel.ki-profile-inline .ki-meta,#kraken-intel-panel.ki-profile-inline .ki-row,#kraken-intel-panel.ki-profile-inline .ki-note{border-color:var(--panel-divider-outer-side-color,#555)}
            #kraken-intel-panel.ki-profile-inline .ki-slot{color:var(--default-blue-color,#71b6d7)}
            #kraken-intel-panel.ki-profile-inline .ki-item small,#kraken-intel-panel.ki-profile-inline .ki-meta,#kraken-intel-panel.ki-profile-inline .ki-note{color:var(--default-color-light,#aaa)}
            .ki-attack-weapon-host{position:relative!important;overflow:visible!important}
            .ki-enemy-weapons-layer{position:fixed;z-index:2147483000;inset:0;pointer-events:none}
            .ki-enemy-weapon-label{position:absolute;box-sizing:border-box;max-width:min(115px,30vw);transform:translate(-50%,-50%);color:#f4f4f4;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px;text-align:center;font:10px/1.2 Arial,sans-serif;text-shadow:0 1px 2px #000,0 0 4px #000,0 0 7px #000;touch-action:none}
            .ki-enemy-weapon-label img{display:block;width:72px;height:51px;object-fit:contain;filter:drop-shadow(0 1px 2px #000)}
            .ki-enemy-weapon-copy{display:block;min-width:0;width:100%}
            .ki-enemy-weapon-label strong,.ki-enemy-weapon-label .ki-enemy-weapon-copy>span{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
            .ki-enemy-weapon-label strong{font-size:11px}
            .ki-enemy-weapon-label .ki-enemy-weapon-copy>span{color:#d6dde0}
            .ki-attack-avatar-host{position:relative!important}
            .ki-armour-stat-label{position:absolute;z-index:12;max-width:145px;border:1px solid #177d8688;border-radius:4px;background:#10171bd9;color:#e9f3f4;pointer-events:none;padding:3px 5px;font:8px/1.2 Arial,sans-serif;box-shadow:0 2px 6px #0007}
            .ki-armour-stat-label strong,.ki-armour-stat-label span{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
            .ki-armour-stat-label span{color:#9eb0b5}
            html.ki-loadout-revealed [class*='modal'][class*='defender']{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:transparent!important;pointer-events:none!important}
            html.ki-loadout-revealed .ki-attack-avatar-host img,html.ki-loadout-revealed .ki-attack-avatar-host [class*='avatar'],html.ki-loadout-revealed .ki-attack-avatar-host [class*='defender']{filter:none!important;opacity:1!important}
            @media (width<=700px){.ki-enemy-weapon-label{max-width:30vw;font-size:9px}.ki-enemy-weapon-label img{width:66px;height:48px}.ki-enemy-weapon-label strong{font-size:10px}.ki-armour-stat-label{max-width:120px}}
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
        wireProfileAttackControls(actions);
        return true;
    }

    function profileAttackUrl() {
        return `/page.php?sid=attack&user2ID=${currentTargetId()}`;
    }

    function isProfileAttackControl(element) {
        if (!element || typeof element.closest !== "function") return false;
        const control = element.closest("a,button,[role='button']");
        if (!control) return false;
        const labelledChild = control.querySelector("[title],[aria-label],img[alt]");
        const signature = [
            control.getAttribute("href"),
            control.id,
            control.className,
            control.getAttribute("title"),
            control.getAttribute("aria-label"),
            control.getAttribute("data-action"),
            control.textContent,
            labelledChild?.getAttribute("title"),
            labelledChild?.getAttribute("aria-label"),
            labelledChild?.getAttribute("alt")
        ].filter(Boolean).join(" ").toLowerCase();
        return signature.includes("attack") || signature.includes("sid=attack");
    }

    function wireProfileAttackControls(actions = profileActionsPanel()) {
        if (!actions) return;
        for (const control of actions.querySelectorAll("a,button,[role='button']")) {
            if (!isProfileAttackControl(control)) continue;
            if (control.tagName === "A") control.href = profileAttackUrl();
            control.removeAttribute("disabled");
            control.removeAttribute("aria-disabled");
            control.classList.remove("disabled", "is-disabled");
        }
    }

    function installProfileAttackNavigation() {
        W.document.addEventListener("click", (event) => {
            const actions = profileActionsPanel();
            const target = event.target && typeof event.target.closest === "function" ? event.target : null;
            if (!actions || !target || !actions.contains(target) || !isProfileAttackControl(target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            W.location.assign(profileAttackUrl());
        }, true);
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
        if (pageDetails().type === "attack") observeAttackLayout();
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
        refreshLatestArmourDetails();
        console.info(`[${SCRIPT}] Loaded shared intel v${VERSION}`);
    }

    if (!currentTargetId() || W.__krakenIntelInstalled) return;
    W.__krakenIntelInstalled = true;
    if (pageDetails().type === "attack") {
        installFetchObserver();
        W.addEventListener("resize", scheduleAttackEquipmentRender, { passive: true });
        W.addEventListener("scroll", scheduleAttackEquipmentRender, { passive: true });
        W.visualViewport?.addEventListener("resize", scheduleAttackEquipmentRender, { passive: true });
    }
    if (pageDetails().type === "profile") installProfileAttackNavigation();
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

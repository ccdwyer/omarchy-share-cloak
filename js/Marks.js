.pragma library

// Persistent match rules: class (case-insensitive exact) + title regex.
// A class-only rule uses title ".*" so "Signal" stays marked forever.

function normalizeClass(value) {
    return String(value || "").trim()
}

function compileTitle(pattern) {
    var src = String(pattern === undefined || pattern === null ? ".*" : pattern)
    if (!src.length)
        src = ".*"
    try {
        return { ok: true, regex: new RegExp(src, "i"), source: src }
    } catch (e) {
        return { ok: false, regex: null, source: src, literal: src.toLowerCase() }
    }
}

function ruleKey(rule) {
    if (!rule)
        return ""
    return normalizeClass(rule["class"]).toLowerCase() + "\n" + String(rule.title === undefined ? ".*" : rule.title)
}

function sanitize(rules) {
    var list = rules || []
    var out = []
    var seen = {}
    for (var i = 0; i < list.length; i++) {
        var r = list[i]
        if (!r)
            continue
        var klass = normalizeClass(r["class"] || r.className || r.appId)
        if (!klass)
            continue
        var title = r.title === undefined || r.title === null ? ".*" : String(r.title)
        var key = klass.toLowerCase() + "\n" + title
        if (seen[key])
            continue
        seen[key] = true
        out.push({ class: klass, title: title })
    }
    return out
}

function matchesRule(client, rule) {
    if (!client || !rule)
        return false
    var klass = String(client["class"] || client.className || client.appId || "")
    var title = String(client.title || "")
    if (klass.toLowerCase() !== normalizeClass(rule["class"]).toLowerCase())
        return false
    var compiled = compileTitle(rule.title)
    if (compiled.ok)
        return compiled.regex.test(title)
    return title.toLowerCase().indexOf(compiled.literal) >= 0
}

function isMarked(client, rules) {
    var list = rules || []
    for (var i = 0; i < list.length; i++) {
        if (matchesRule(client, list[i]))
            return true
    }
    return false
}

function classWindows(clients, className) {
    var want = normalizeClass(className).toLowerCase()
    var list = clients || []
    var out = []
    if (!want)
        return out
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (!c)
            continue
        if (String(c["class"] || c.className || "").toLowerCase() === want)
            out.push(c)
    }
    return out
}

function tiledClassCount(clients, className) {
    var list = classWindows(clients, className)
    var n = 0
    for (var i = 0; i < list.length; i++) {
        if (list[i] && !list[i].floating)
            n++
    }
    return n
}

function markNotice(className, tiledCount) {
    var klass = normalizeClass(className) || "window"
    var tiled = Number(tiledCount) || 0
    if (tiled === 1)
        return "marked " + klass + " — 1 tiled window will vanish; uncloak tiles it back"
    if (tiled > 1)
        return "marked " + klass + " — " + tiled + " tiled windows will vanish; uncloak tiles them back"
    return "marked " + klass
}

function classIsMarked(className, rules) {
    var want = normalizeClass(className).toLowerCase()
    if (!want)
        return false
    var list = rules || []
    for (var i = 0; i < list.length; i++) {
        if (normalizeClass(list[i] && list[i]["class"]).toLowerCase() === want)
            return true
    }
    return false
}

function addClass(rules, className, titlePattern) {
    var next = sanitize(rules)
    var klass = normalizeClass(className)
    if (!klass)
        return next
    var title = titlePattern === undefined || titlePattern === null ? ".*" : String(titlePattern)
    var key = klass.toLowerCase() + "\n" + title
    for (var i = 0; i < next.length; i++) {
        if (ruleKey(next[i]) === key)
            return next
    }
    next.push({ class: klass, title: title })
    return next
}

function removeClass(rules, className) {
    var want = normalizeClass(className).toLowerCase()
    var list = sanitize(rules)
    var out = []
    for (var i = 0; i < list.length; i++) {
        if (normalizeClass(list[i]["class"]).toLowerCase() !== want)
            out.push(list[i])
    }
    return out
}

function toggleClass(rules, className, titlePattern) {
    if (classIsMarked(className, rules))
        return removeClass(rules, className)
    return addClass(rules, className, titlePattern)
}

function escapeTitle(title) {
    return String(title || "").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}

function hasStarRule(rules, className) {
    var want = normalizeClass(className).toLowerCase()
    var list = rules || []
    for (var i = 0; i < list.length; i++) {
        if (normalizeClass(list[i] && list[i]["class"]).toLowerCase() !== want)
            continue
        if (String(list[i].title === undefined || list[i].title === null ? ".*" : list[i].title) === ".*")
            return true
    }
    return false
}

function toggleClient(rules, client, liveClients) {
    var klass = normalizeClass(client && (client["class"] || client.className || client.class))
    if (!klass)
        return sanitize(rules)
    var next = sanitize(rules)
    if (hasStarRule(next, klass)) {
        next = removeClass(next, klass)
        var others = classWindows(liveClients, klass)
        for (var i = 0; i < others.length; i++) {
            var other = others[i]
            if (!other || other.address === (client && client.address))
                continue
            next = addClass(next, klass, "^" + escapeTitle(other.title) + "$")
        }
        return next
    }
    if (isMarked(client, next)) {
        var title = String((client && client.title) || "")
        var out = []
        for (var j = 0; j < next.length; j++) {
            var r = next[j]
            if (normalizeClass(r["class"]).toLowerCase() !== klass.toLowerCase()) {
                out.push(r)
                continue
            }
            if (matchesRule(client, r))
                continue
            out.push(r)
        }
        return out
    }
    var exact = String((client && client.title) || "")
    return addClass(next, klass, exact ? "^" + escapeTitle(exact) + "$" : ".*")
}

function markedClients(clients, rules) {
    var list = clients || []
    var out = []
    for (var i = 0; i < list.length; i++) {
        if (isMarked(list[i], rules))
            out.push(list[i])
    }
    return out
}

function unmarkedClients(clients, rules) {
    var list = clients || []
    var out = []
    for (var i = 0; i < list.length; i++) {
        if (!isMarked(list[i], rules))
            out.push(list[i])
    }
    return out
}

function uniqueClasses(clients) {
    var list = clients || []
    var seen = {}
    var out = []
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        var klass = String((c && (c["class"] || c.className || c.appId)) || "")
        if (!klass)
            continue
        var key = klass.toLowerCase()
        if (seen[key])
            continue
        seen[key] = true
        out.push({
            class: klass,
            title: String((c && c.title) || ""),
            address: c.address || ""
        })
    }
    return out
}

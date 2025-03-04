
const TokenTypes = {
    OPERATOR: "operator",
    STRING: "string",
    TEXT: "text"
}
const AtomTypes = {
    NODE: "node",
    ATTRIBUTES: "attributes",
    TEXT: "text",
    FUNCTION: "function"
}

function lexer(input) {
    const tokens = [];
    let current = 0;
    function flowText() {
        let char = input[current], value = [];
        while (/[^"<>&\x00-\x1F\x7F/=(), ]|\r?\n/i.test(char)) {
            value.push(char);
            char = input[++current];
        }
        return value.join("");
    }
    function flowString() {
        let char = input[current], value = [];
        while (char !== "\"") {
            if (input[current] === undefined) {
                throw new SyntaxError(`双引号没有被闭合`);
            }
            value.push(char);
            char = input[++current];
        }
        if (input[current] === "\"") {
            current++;
        }
        return value.join("");
    }
    function lText(length) {
        let value = [];
        for (let i = 0; i < length; i++) {
            value.push(input[current + i]);
        }
        return value.join("");
    }
    while (current < input.length) {
        let char = input[current];

        if (/\s/.test(char)) {
            current++;
            continue;
        }
        if (char === "<" && [1, 2, 3].map(v => input[current + v]).join("") === "!--") {
            current += 4;
            while (lText(2) !== "--" && input[current + 2] === ">") {
                current++;
            }
            current += 3;
            continue;
        }
        if (["<", ">", "=", "/", "(", ",", ")"].includes(char)) {
            tokens.push({ type: TokenTypes.OPERATOR, value: char });
            current++;
            continue;
        }
        if (char === "\"") {
            current++;
            tokens.push({ type: TokenTypes.STRING, value: flowString() });
            continue;
        }
        if (/[^"<>&\x00-\x1F\x7F/= ]|\r?\n/i.test(char)) {
            tokens.push({ type: TokenTypes.TEXT, value: flowText() });
            continue;
        }
        if (char === "&") {
            let parseMap = {
                "&amp": "&",
                "&lt": "<",
                "&gt": ">",
                "&quot": "\""
            }
            let l = Object.keys(parseMap).find(v => lText(v.length) === v);
            if (l) {
                current += l.length;
                tokens.push({ type: TokenTypes.TEXT, value: parseMap[l] });
                continue;
            }
        }

        throw new SyntaxError(`无效或意外的字符: ${char}`);
    }
    return tokens;
}

function parser(tokens) {
    let current = 0;
    function wrapNode(arg = {}) {
        let res = {
            type: "",
            tag: "",
            value: null,
            attributes: {},
            children: [],
            args: []
        }
        Object.assign(res, arg);
        return res;
    }
    function is(token, type, value) {
        return token.type === type && token.value === value;
    }
    function walk({ parent, expected }) {
        let token = tokens[current];

        if (is(token, TokenTypes.OPERATOR, "<")) {
            current++;
            let node = wrapNode();
            if (is(tokens[current], TokenTypes.OPERATOR, "/")) {
                current++;
                if (tokens[current]?.type === TokenTypes.TEXT) {
                    node.tag = tokens[current++].value;
                    node.type = AtomTypes.NODE;
                } else {
                    throw new SyntaxError(`预期应该是标签名，实际得到: ${tokens[current]?.value}`);
                }
                if (is(tokens[current], TokenTypes.OPERATOR, ">")) {
                    current++;
                    return node;
                } else {
                    throw new SyntaxError(`你应该闭合标签`)
                }
            }
            if (tokens[current]?.type === TokenTypes.TEXT) {
                node.tag = tokens[current++].value;
                node.type = AtomTypes.NODE;
            } else {
                throw new SyntaxError(`预期应该是标签名，实际得到: ${tokens[current]?.value}`);
            }
            if (is(tokens[current], TokenTypes.OPERATOR, "/" && is(tokens[current + 1], TokenTypes.OPERATOR, "/"))) {
                current += 2;
                return node;
            }
            if (!is(tokens[current], TokenTypes.OPERATOR, ">")) {
                while (tokens[current].type === TokenTypes.TEXT) {
                    let attr = walk({ expected: AtomTypes.ATTRIBUTES });
                    if (attr && attr.type === AtomTypes.ATTRIBUTES) {
                        node.attributes[attr.attributes[0]] = attr.attributes[1];
                    } else if (attr && attr.type === AtomTypes.FUNCTION) {
                        node.attributes[attr.attributes[0]] = attr
                    }
                }
                if (is(tokens[current], TokenTypes.OPERATOR, "/") && is(tokens[current + 1], TokenTypes.OPERATOR, ">")) {
                    current += 2;
                    return node;
                }
            }
            if (is(tokens[current], TokenTypes.OPERATOR, ">")) {
                current++;
                while (!is(tokens[current], TokenTypes.OPERATOR, "<") ||
                    (!is(tokens[current + 1], TokenTypes.OPERATOR, "/")) ||
                    (!is(tokens[current + 2], TokenTypes.TEXT, node.tag))
                ) {
                    if (tokens[current] === undefined) {
                        throw new SyntaxError(`严格来讲你应该闭合标签，但实际没有`);
                    }
                    let res = walk({ parent: node });
                    if (res.type === AtomTypes.TEXT) {
                        if (node.attributes.textContent === undefined) node.attributes.textContent = "";
                        node.attributes.textContent = node.attributes.textContent + res.value;
                    } else if (res.type === AtomTypes.NODE) {
                        node.children.push(res);
                    }
                }
                if (is(tokens[current + 3], TokenTypes.OPERATOR, ">")) {
                    current += 4;
                    return node;
                } else {
                    throw new SyntaxError(`没有闭合的标签`);
                }
            }
            throw new SyntaxError(`意料之外的行为：${JSON.stringify(tokens[current])}`);
        }
        if (token.type === TokenTypes.TEXT) {
            let node = wrapNode();
            current++;
            if (is(tokens[current], TokenTypes.OPERATOR, "=")) {
                node.attributes[0] = token.value;
                current++;
                if (tokens[current]?.type === TokenTypes.TEXT && is(tokens[current + 1], TokenTypes.OPERATOR, "(")) {
                    node.type = AtomTypes.FUNCTION;
                    node.value = tokens[current].value;
                    current += 2;
                    let args = [];
                    while (!is(tokens[current], TokenTypes.OPERATOR, ")")) {
                        if (tokens[current] === undefined) throw new SyntaxError(`未闭合的括号`);
                        if (tokens[current].type !== TokenTypes.OPERATOR) {
                            args.push(tokens[current]);
                            current++;
                        } else {
                            throw new SyntaxError(`意外的值: ${JSON.stringify(tokens[current])}`);
                        }
                        if (is(tokens[current], TokenTypes.OPERATOR, ",")) {
                            current++;
                        } else if (is(tokens[current], TokenTypes.OPERATOR, ")")) {
                            break;
                        }
                    }
                    current++;
                    node.args = args;
                    return node;
                }
                node.type = AtomTypes.ATTRIBUTES;
                if (tokens[current]?.type !== TokenTypes.STRING && tokens[current]?.type !== TokenTypes.TEXT) throw new SyntaxError(`预期应该是字段值，实际得到${tokens[current]?.value}`);
                node.attributes[1] = tokens[current].value;
                current++;
                return node;
            } else if (expected === AtomTypes.ATTRIBUTES) {
                node.type = AtomTypes.ATTRIBUTES;
                node.attributes[0] = token.value;
                return node;
            } else {
                node.type = AtomTypes.TEXT;
                node.value = token.value;
                return node;
            }
        }

        throw new SyntaxError(`预期之外的Token: ${JSON.stringify(token)}`);
    }

    let body = wrapNode({
        type: AtomTypes.NODE,
        tag: "body",
    });
    while (current < tokens.length) {
        let node = walk({ parent: body });
        if (node) body.children.push(node);
    }
    return body;
}

function render(ui, nodes) {
    const UiMap = {
        "box": UiBox,
        "text": UiText,
        "img": UiImage
    }
    const functions = {
        "rgb": (r, g, b) => (Vec3.create({ r, g, b }))
    }
    function exec(parent, node) {
        if (node === null) return null;
        if (node.type === AtomTypes.FUNCTION) {
            return functions[node.value]?.(...node.args.map(a => (Number(a.value) == a.value) ? parseFloat(a.value) : a.value))
        } else if (node.type === AtomTypes.NODE) {
            if (node.tag === "body") {
                node.children.forEach(e => exec(ui, e));
                return null;
            }
            /**@type {UiBox|UiText|UiImage} */
            let uinode = UiMap[node.tag].create();
            if (parent) uinode.parent = parent;
            Object.keys(node.attributes).forEach(k => {
                let attr = node.attributes[k];
                switch (k) {
                    case "x":
                        uinode.position.offset.copy({ x: attr, y: uinode.position.offset.y });
                        break;
                    case "y":
                        uinode.position.offset.copy({ x: uinode.position.offset.x, y: attr });
                        break;
                    case "height":
                    case "h":
                        uinode.size.offset.copy({ x: uinode.size.offset.x, y: attr });
                        break;
                    case "width":
                    case "w":
                        uinode.size.offset.copy({ x: attr, y: uinode.size.offset.y });
                        break;
                    case "name":
                    case "id":
                        uinode.name = attr;
                        break;
                    case "scale":
                    case "resize":
                        uinode.uiScale.scale = attr;
                        break;
                    case "backgroundOpacity":
                    case "background-opacity":
                        if (attr.endsWith("%")) attr = parseFloat(attr.slice(0, attr.length - 1)) / 100;
                        uinode.backgroundOpacity = parseFloat(attr);
                        break;
                    case "zIndex":
                    case "z-index":
                    case "z-Index":
                        uinode.zIndex = parseInt(attr);
                        break;
                    case "autoResize":
                    case "auto-resize":
                        uinode.autoResize = attr;
                        break;
                    case "visible":
                        uinode.visible = attr === "false" ? false : (attr === "true" ? true : false);
                        break;
                    case "textContent":
                    case "text":
                    case "text-content":
                        uinode.textContent = attr;
                        break;
                    case "textFontSize":
                    case "text-font-size":
                    case "font-size":
                    case "text-size":
                        uinode.textFontSize = parseFloat(attr);
                        break;
                    case "textXAlignment":
                    case "text-align-x":
                    case "textXAlign":
                        uinode.textXAlignment = attr;
                        break;
                    case "textYAlignment":
                    case "text-align-y":
                    case "textYAlign":
                        uinode.textYAlignment = attr;
                        break;
                    case "image":
                    case "src":
                    case "image-src":
                        uinode.image = attr;
                        break;
                    case "imageOpacity":
                    case "opacity":
                    case "img-oct":
                        if (attr.endsWith("%")) attr = parseFloat(attr.slice(0, attr.length - 1)) / 100;
                        uinode.imageOpacity = parseFloat(attr);
                        break;
                    case "backgroundColor":
                    case "background-color":
                    case "bc":
                        if (attr && attr.type === AtomTypes.FUNCTION) uinode.backgroundColor.copy(exec(parent, attr));
                        else uinode.backgroundColor.copy(attr);
                        break;
                    case "textColor":
                    case "text-color":
                    case "color":
                    case "tc":
                        if (attr && attr.type === AtomTypes.FUNCTION) uinode.textColor.copy(exec(parent, attr));
                        else uinode.textColor.copy(attr);
                        break;
                }
            })
            node.children.forEach(e => exec(ui, e));
            return null;
        }
    }
    exec(ui, nodes);
}


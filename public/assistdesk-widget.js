(function () {
  if (window.__assistDeskWidgetMounted) {
    return;
  }

  window.__assistDeskWidgetMounted = true;

  var config = window.assistDeskWidget || {};
  var widgetId = config.widgetId || window.TICKETDESK_ID;

  if (!widgetId) {
    console.error("AssistDesk widget requires a widgetId.");
    return;
  }

  var scriptElement = document.currentScript;
  var baseUrl = new URL(scriptElement && scriptElement.src ? scriptElement.src : window.location.href).origin;
  var iframeUrl = baseUrl + "/widget/" + encodeURIComponent(widgetId);
  var initialSide = config.position === "BOTTOM_LEFT" ? "left" : "right";

  var host = document.createElement("div");
  host.id = "assistdesk-widget-root";
  document.body.appendChild(host);

  var shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = [
    "<style>",
    ":host{all:initial}",
    ".wrap{position:fixed;bottom:24px;z-index:2147483000;font-family:Arial,sans-serif}",
    ".wrap.right{right:24px}.wrap.left{left:24px}",
    ".panel{width:380px;height:min(720px,calc(100vh - 110px));border:none;border-radius:28px;overflow:hidden;background:#fff;box-shadow:0 30px 90px rgba(15,23,42,.35);opacity:0;pointer-events:none;transform:translateY(16px) scale(.98);transition:all .24s ease}",
    ".panel.open{opacity:1;pointer-events:auto;transform:translateY(0) scale(1)}",
    ".frame{width:100%;height:100%;border:none;background:#fff}",
    ".launcher{margin-top:16px;display:flex}",
    ".wrap.right .launcher{justify-content:flex-end}.wrap.left .launcher{justify-content:flex-start}",
    ".button{width:56px;height:56px;border:none;border-radius:999px;background:#3b82f6;color:#fff;cursor:pointer;box-shadow:0 16px 34px rgba(15,23,42,.28);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:0;transition:transform .18s ease}",
    ".button:hover{transform:translateY(-1px)}",
    ".button:focus-visible{outline:3px solid rgba(59,130,246,.5);outline-offset:3px}",
    ".button svg{width:24px;height:24px}",
    ".avatar{width:100%;height:100%;object-fit:cover;display:none}",
    "@media (max-width: 640px){.wrap{left:12px !important;right:12px !important;bottom:12px}.panel{width:100%;height:calc(100vh - 84px);border-radius:24px}.wrap .launcher{justify-content:flex-end}}",
    "</style>",
    '<div class="wrap ' + initialSide + '" id="wrap">',
    '  <div class="panel" id="panel"></div>',
    '  <div class="launcher"><button class="button" id="button" aria-label="Open chat" aria-expanded="false">',
    '    <img class="avatar" id="avatar" alt="" />',
    '    <svg id="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 7.5h12A1.5 1.5 0 0 1 19.5 9v6A1.5 1.5 0 0 1 18 16.5H11l-4.5 3V16.5H6A1.5 1.5 0 0 1 4.5 15V9A1.5 1.5 0 0 1 6 7.5Z"></path></svg>',
    '    <svg id="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="display:none"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
    "  </button></div>",
    "</div>",
  ].join("");

  var wrap = shadowRoot.getElementById("wrap");
  var panel = shadowRoot.getElementById("panel");
  var button = shadowRoot.getElementById("button");
  var avatar = shadowRoot.getElementById("avatar");
  var iconChat = shadowRoot.getElementById("icon-chat");
  var iconClose = shadowRoot.getElementById("icon-close");
  var isOpen = false;
  var hasAvatar = false;

  // The iframe is created with DOM APIs so the page's referrer (used by AssistDesk to
  // check Allowed Domains) is always sent, even if the host page uses no-referrer.
  var frame = document.createElement("iframe");
  frame.className = "frame";
  frame.title = "AssistDesk chat widget";
  frame.setAttribute("referrerpolicy", "origin");
  frame.setAttribute("allow", "microphone; clipboard-write");
  frame.src = iframeUrl;
  panel.appendChild(frame);

  function renderLauncherIcon() {
    avatar.style.display = !isOpen && hasAvatar ? "block" : "none";
    iconChat.style.display = !isOpen && !hasAvatar ? "block" : "none";
    iconClose.style.display = isOpen ? "block" : "none";
  }

  function setOpen(nextValue) {
    isOpen = nextValue;
    panel.classList.toggle("open", isOpen);
    button.setAttribute("aria-label", isOpen ? "Close chat" : "Open chat");
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    renderLauncherIcon();
  }

  button.addEventListener("click", function () {
    setOpen(!isOpen);
  });

  window.addEventListener("message", function (event) {
    if (
      event.origin !== baseUrl ||
      event.source !== frame.contentWindow ||
      !event.data ||
      event.data.type !== "assistdesk-widget"
    ) {
      return;
    }

    if (event.data.action === "close") {
      setOpen(false);
    }

    if (event.data.action === "config") {
      if (/^#[0-9a-fA-F]{6}$/.test(event.data.primaryColor || "")) {
        button.style.background = event.data.primaryColor;
      }

      var side = event.data.position === "BOTTOM_LEFT" ? "left" : "right";
      wrap.classList.remove("left", "right");
      wrap.classList.add(side);

      if (typeof event.data.avatarUrl === "string" && event.data.avatarUrl) {
        avatar.src = event.data.avatarUrl.indexOf("/") === 0 ? baseUrl + event.data.avatarUrl : event.data.avatarUrl;
        hasAvatar = true;
        renderLauncherIcon();
      }
    }
  });
})();

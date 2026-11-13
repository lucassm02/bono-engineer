import { SITE } from '../config.mjs';
import { heroBackdrop, heroDash, liveChip, motionSection, radioCycle } from '../motion.mjs';
import { faqHtml, faqLd, ICON_DOWNLOAD, softwareLd } from '../render.mjs';

export const FAQ_EN = [
  {
    q: 'Is Bono Engineer free?',
    a: 'Yes. Bono is free for personal, noncommercial use, with no account, subscription or sign-up. The source code is available but is not open source: the license (PolyForm Noncommercial 1.0.0) allows studying, changing and sharing it for noncommercial purposes, and does not allow commercial use.',
  },
  {
    q: 'Do I need a PC, or does it work with just the PS5?',
    a: 'You need a Windows PC on the same network as the PS5. Gran Turismo 7 sends telemetry over the network and Bono runs on the PC. A phone or tablet on the same network works as a second screen.',
  },
  {
    q: 'Windows says the installer is not safe. What now?',
    a: 'The installer is not code-signed yet, so SmartScreen does not recognize the publisher. Download it only from the project releases page on GitHub, click "More info", then "Run anyway".',
  },
  {
    q: 'How do I update Bono?',
    a: 'Starting with version 0.8.0, open Settings → About in the Windows app. You can check for a new version, read what changed, download it and restart to install. If you use an earlier version, install the current version once.',
  },
  {
    q: 'Can I hear the engineer on my PS5 headset?',
    a: 'Yes, through Discord. Bono sends the radio calls to a voice channel you create, and you hear them on the PS5 headset. The setup guide is in Portuguese for now.',
  },
  {
    q: 'Does the app speak English?',
    a: 'Yes. The interface and the radio come in Brazilian Portuguese, English and Spanish, with three offline neural voices per language. Pick the language in Settings.',
  },
  {
    q: 'How do I back up my history?',
    a: 'In Settings, Accounts and data, use Export backup to create a .bono file with sessions, laps and settings (never keys or passwords). On another PC, Import backup adds it to the existing history or replaces it. You can also pick another data folder, such as a OneDrive one.',
  },
  {
    q: 'Does Bono show the GT7 Daily Races?',
    a: 'It does, if you want it. The first time, Bono asks whether you want the weekly news. If you say yes, it reads the public pages of DG EDGE from your PC, at most once an hour, and shows the rules, medal times and the 1st place time next to your best lap. It stores no player names and you can turn it off at any time.',
  },
  {
    q: 'Where does my data go?',
    a: 'Nowhere. Sessions, laps and recordings stay in a folder on your PC, and Bono has no server or account. Discord radio and the optional AI debrief use the internet only if you turn them on, and the AI coach uses your own Anthropic or OpenAI key (or your own agent, through MCP).',
  },
];

export function render(ctx) {
  const v = SITE.version;
  const hero = ctx.pic(
    'live-dashboard',
    'Bono Live screen with the context strip (track, car and engineer), the delta against your best lap, gear, speed, lap times, sectors and the shift lights',
    { eager: true, sizes: '(min-width: 1000px) 62vw, 100vw' },
  );
  const body = `
<section class="hero">
  ${heroBackdrop()}
  <div class="wrap hero-grid">
    <div>
      <h1>Your race engineer for Gran Turismo 7</h1>
      <p class="lead">Bono reads the telemetry from your PS5, shows the live delta and tells you over the radio where to brake. After the session, it points to the corner where you lost time.</p>
      <div class="cta-row">
        <a class="btn" href="${SITE.releases}" rel="noopener">${ICON_DOWNLOAD}Download for Windows</a>
        <a class="btn btn-ghost" href="#motion">How it works</a>
      </div>
      <p class="fine">Version <span class="num">${v}</span>. Free, no account, Windows 64-bit. The app interface is available in English.</p>
    </div>
    <figure class="shot">
      ${hero}
      ${heroDash(ctx)}
      ${liveChip('en')}
      ${radioCycle('en')}
    </figure>
  </div>
</section>

${motionSection(ctx, 'en')}

<section class="sec" id="what-it-does" aria-labelledby="h-does">
  <div class="wrap split">
    <div class="split-head">
      <h2 id="h-does">A race engineer, not just a screen of numbers</h2>
      <p>From warm-up to debrief, Bono follows the session and shows what to practise on the next lap.</p>
    </div>
    <ul class="rows">
      <li class="row">
        <div><h3>Live</h3><p>Delta against your best lap or a top-driver replay, gear, revs, tyres, fuel and track map. Eleven screens, on the PC or on a tablet on the same network.</p></div>
        <div class="read gain">−0.033<small>live delta, in seconds</small></div>
      </li>
      <li class="row">
        <div><h3>Track recognition before the race</h3><p>When GT7 shows your car moving in the background on the pre-race screen, Bono uses that path to identify the circuit. The Live dashboard shows a probable match before your first lap.</p></div>
      </li>
      <li class="row">
        <div><h3>Race radio</h3><p>Short calls before the corner, like “light braking in 100 metres”. It plays on the PC or, through Discord, on your PS5 headset.</p></div>
        <div class="read acc">100 m<small>warning before the brake point</small></div>
      </li>
      <li class="row">
        <div><h3>Engineer tasks</h3><p>Create a driving reminder in the track’s <strong>Tasks</strong> tab or approve a suggestion from AI Coach or your MCP agent. The radio speaks at the chosen point, such as “At turn seven, entry. Brake twenty meters later.” Allow the download for your selected voice to hear the tasks.</p></div>
      </li>
      <li class="row">
        <div><h3>Lap comparison</h3><p>Overlay speed, brake and throttle aligned by distance and see which corner took each tenth away. “Where you lose time” lists the three costliest corners with the probable cause, and the map colours the lap by gain and loss, speed or brake.</p></div>
        <div class="read loss">+0.024<small>the costliest corner, in seconds</small></div>
      </li>
      <li class="row">
        <div><h3>Goal and session summary</h3><p>Set a goal per track (or take the suggestion: the ideal lap) and follow the difference live. When you finish, one screen shows the best lap, pace, consistency, where you gained and lost per corner and up to three tips for next time.</p></div>
        <div class="read gain">−0.215<small>best lap against the goal, in seconds</small></div>
      </li>
      <li class="row">
        <div><h3>Weekly summary</h3><p>The last 7 days on one screen: the best lap of each track against the record before it, personal records and goals reached. Copy it as text or share it as an image. If this week's Daily Race runs on your track, the next medal becomes a goal suggestion.</p></div>
        <div class="read acc">7 days<small>text or image to share</small></div>
      </li>
      <li class="row">
        <div><h3>Lap replay</h3><p>Watch a lap the way Gran Turismo shows it: a dot runs the map while you see brake, throttle and steering at every instant. Put your best lap or a top driver's lap beside it as a ghost, and tap what went wrong to jump straight to the spot.</p></div>
        <div class="read acc">0.25× to 2×<small>replay speed, 0.1 s steps</small></div>
      </li>
      <li class="row">
        <div><h3>Voice corner drill</h3><p>Pick a corner and the engineer talks only about it, on every pass, rating it against your best: stretch time, speeds and braking point. It keeps the last ten passes and shows a summary when you stop.</p></div>
        <div class="read acc">10 passes<small>on the same corner, lap after lap</small></div>
      </li>
      <li class="row">
        <div><h3>Daily Races</h3><p>The three GT7 races of the week, with the rules, medal times and the 1st place time next to your best lap on the same track. Off until you accept.</p></div>
        <div class="read acc">3 races<small>a week, with medals</small></div>
      </li>
      <li class="row">
        <div><h3>Your data, your way</h3><p>Pick the folder where your history lives (even a OneDrive one) and move it to another PC with a .bono backup. Keys and passwords never go in the file.</p></div>
        <div class="read">.bono<small>one file with your whole history</small></div>
      </li>
      <li class="row">
        <div><h3>Optional AI coach</h3><p>Ask about your laps — strengths and weaknesses, times of your latest sessions, what to improve — and get the three costliest corners with one action for each. It works through your own agent (Claude Code, Codex) over MCP with no key, or with your own Anthropic or OpenAI key. Everything else works without it.</p></div>
        <div class="read">3 corners<small>one action each</small></div>
      </li>
    </ul>
  </div>
</section>

<section class="sec" id="how-it-works" aria-labelledby="h-how">
  <div class="wrap">
    <h2 id="h-how">Connect, drive, analyse</h2>
    <ol class="sectors">
      <li class="sector"><span class="tag" aria-hidden="true">S1</span><h3>Connect the PS5</h3><p>Install Bono on a PC on the same network as the console. It finds the PS5 by itself and a first-run assistant guides you.</p></li>
      <li class="sector"><span class="tag" aria-hidden="true">S2</span><h3>Drive</h3><p>Open GT7 and enter a track. The Live screen lights up, the engineer talks and every lap is recorded with sectors, validity and telemetry traces. A guided tour and a Help center explain each screen.</p></li>
      <li class="sector"><span class="tag" aria-hidden="true">S3</span><h3>Analyse</h3><p>Compare with your best lap or a top replay, see where the time went and practise one corner at a time.</p></li>
    </ol>
  </div>
</section>

<section class="sec" id="screens" aria-labelledby="h-screens">
  <div class="wrap">
    <h2 id="h-screens">Inside the app</h2>
    <p class="lead">Screenshots use demo data and the Brazilian Portuguese interface.</p>
    <div class="gal">
      <figure class="fig wide">
        ${ctx.pic('lap-comparison', 'Lap comparison screen with speed, throttle, brake, gear and steering of two laps overlaid, and a track map coloured by time gained or lost', { sizes: '(min-width: 1240px) 1200px, 100vw' })}
        <figcaption><strong>Lap comparison</strong>Speed, throttle, brake, gear and steering overlaid, with accumulated delta and a map of where you gain and lose.</figcaption>
      </figure>
      <figure class="fig">
        ${ctx.pic('track-history', 'Track home screen with totals for tracks, sessions and laps, search, and the best lap on a track', { sizes: '(min-width: 900px) 590px, 100vw' })}
        <figcaption><strong>Home by track</strong>Your best times per track and car, with progress and what is left to gain.</figcaption>
      </figure>
      <figure class="fig">
        ${ctx.pic('engineer-menu', 'Engineer menu open over the Live screen', { sizes: '(min-width: 900px) 590px, 100vw' })}
        <figcaption><strong>Engineer menu</strong>Pick the mode (practice, qualifying or race), speech level and engineer voice without leaving Live.</figcaption>
      </figure>
    </div>
  </div>
</section>

<section class="sec" id="privacy" aria-labelledby="h-priv">
  <div class="wrap split">
    <div class="split-head">
      <h2 id="h-priv">Your data stays on your PC</h2>
      <p>No account, no login, no Bono server.</p>
    </div>
    <dl class="facts">
      <div><dt>Local by default</dt><dd>Sessions, laps, traces and recordings live in a folder on your PC, which you can change. Export a .bono backup, delete or move them whenever you like.</dd></div>
      <div><dt>Only what you switch on</dt><dd>The network is used to talk to the PS5, for Discord radio, for the AI debrief and for the Daily Races. The last three stay off until you set them up or accept.</dd></div>
      <div><dt>This site too</dt><dd>No cookies, no analytics and no external fonts.</dd></div>
    </dl>
  </div>
</section>

<section class="sec" id="download" aria-labelledby="h-dl">
  <div class="wrap">
    <div class="dl">
      <div>
        <p class="ver">Version <span class="num">${v}</span> for Windows 64-bit</p>
        <h2 id="h-dl">Download Bono and open GT7</h2>
        <p class="lead">The installer and portable edition are on the GitHub releases page.</p>
        <p>Already on Bono 0.8.0 or later? Open <strong>Settings → About</strong> to check for updates and read the release notes before you update.</p>
        <div class="cta-row"><a class="btn" href="${SITE.releases}" rel="noopener">${ICON_DOWNLOAD}Download Bono ${v}</a></div>
      </div>
      <div>
        <h3>Did Windows show a warning?</h3>
        <p>The installer is not code-signed yet, so SmartScreen does not recognize the publisher. If the file came from the project releases page:</p>
        <ol>
          <li>In the “Windows protected your PC” window, click <strong>More info</strong>.</li>
          <li>Click <strong>Run anyway</strong>.</li>
          <li>If the firewall asks, allow Bono on <strong>private networks</strong>.</li>
        </ol>
        <p>Detailed setup, firewall rules and the Discord radio guide are available in Portuguese: <a href="${ctx.rel('install')}" lang="pt-BR" hreflang="pt-BR">Como instalar</a>, <a href="${ctx.rel('discord')}" lang="pt-BR" hreflang="pt-BR">Rádio no Discord</a>.</p>
      </div>
    </div>
  </div>
</section>

<section class="sec" id="faq" aria-labelledby="h-faq">
  <div class="wrap">
    <h2 id="h-faq">Frequently asked questions</h2>
    <div class="faq">
${faqHtml(FAQ_EN, ctx)}
    </div>
  </div>
</section>`;
  return { body, jsonLd: [softwareLd(ctx.page), faqLd(FAQ_EN)] };
}

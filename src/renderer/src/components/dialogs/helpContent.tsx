/**
 * Контент встроенной справки Remote Hub.
 * Скриншоты разделов приложения (src/renderer/src/assets/help/) генерируются
 * командой `npm run help:shots`. SVG-схемы остаются только для состояний,
 * которые нельзя снять статично: живой терминал, RDP/VNC/SFTP, нативное меню
 * и алгоритм диагностики.
 */

import availabilityShot from '../../assets/help/availability.png';
import credentialsShot from '../../assets/help/credentials.png';
import hostDialogShot from '../../assets/help/host-dialog.png';
import newSessionShot from '../../assets/help/new-session.png';
import overviewShot from '../../assets/help/overview.png';
import sessionErrorShot from '../../assets/help/session-error.png';
import settingsShot from '../../assets/help/settings.png';
import snipsShot from '../../assets/help/snips.png';
import treeShot from '../../assets/help/tree.png';

/* ---------- SVG-палитра (классы подставляют CSS-переменные темы) ---------- */

const MOCK_CSS = `
.m-bg{fill:var(--bg)}
.m-raised{fill:var(--bg-raised)}
.m-hover{fill:var(--bg-hover)}
.m-active{fill:var(--bg-active)}
.m-border{fill:var(--border)}
.m-text{fill:var(--text)}
.m-muted{fill:var(--text-muted)}
.m-accent{fill:var(--accent)}
.m-ok{fill:var(--ok)}
.m-warn{fill:var(--warn)}
.m-danger{fill:var(--danger)}
.m-term{fill:var(--term-bg)}
.m-white{fill:#fff}
.m-frame{fill:var(--bg-raised);stroke:var(--border);stroke-width:1}
.m-line{stroke:var(--border);stroke-width:1}
.m-stroke-muted{stroke:var(--text-muted)}
.m-stroke-text{stroke:var(--text)}
.m-stroke-accent{stroke:var(--accent)}
.m-stroke-warn{stroke:var(--warn)}
.m-stroke-white{stroke:#fff}
`;

function MockStyle(): React.JSX.Element {
  return <style>{MOCK_CSS}</style>;
}

/* ---------- примитивы SVG ---------- */

function T({
  x,
  y,
  children,
  className = 'm-text',
  size = 12,
  weight,
  mono
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
  size?: number;
  weight?: number;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <text
      x={x}
      y={y}
      className={className}
      fontSize={size}
      fontWeight={weight}
      fontFamily={mono ? 'var(--font-mono)' : undefined}
    >
      {children}
    </text>
  );
}

function Mock({
  label,
  w = 640,
  h = 360,
  children
}: {
  label: string;
  w?: number;
  h?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <figure className="help-figure">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="help-mock"
        role="img"
        aria-label={label}
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        <MockStyle />
        <rect className="m-bg" x="0" y="0" width={w} height={h} />
        {children}
      </svg>
      <figcaption className="help-figcaption">{label}</figcaption>
    </figure>
  );
}

function Shot({ src, label }: { src: string; label: string }): React.JSX.Element {
  return (
    <figure className="help-figure">
      <img className="help-shot" src={src} alt={label} loading="lazy" />
      <figcaption className="help-figcaption">{label}</figcaption>
    </figure>
  );
}

/**
 * Иконка из набора приложения (16×16), встроенная в SVG-схему.
 * d — path-данные из Icon.tsx/ProtocolIcon.tsx; цвета — через m-stroke-* классы.
 */
function IconPath({
  x,
  y,
  d,
  className = 'm-stroke-muted',
  w = 1.4
}: {
  x: number;
  y: number;
  d: string | readonly string[];
  className?: string;
  w?: number;
}): React.JSX.Element {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <g transform={`translate(${x} ${y})`} fill="none">
      {paths.map((p, i) => (
        <path
          key={i}
          d={p}
          className={className}
          strokeWidth={w}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

/* path-данные иконок набора (совпадают с Icon.tsx). */
const ICON = {
  'chevron-up': 'M4.6 9.6 8 6.2l3.4 3.4',
  'chevron-down': 'M4.6 6.4 8 9.8l3.4-3.4',
  'arrow-down': 'M8 3.2v9.6M4.6 9.4 8 12.8l3.4-3.4',
  check: 'M3 8.4l3.3 3.3L13 4.6',
  folder: 'M2.2 4.2h3.9l1.5 1.7h6.2a1.1 1.1 0 0 1 1.1 1.1v5.6a1.1 1.1 0 0 1-1.1 1.1H3.3a1.1 1.1 0 0 1-1.1-1.1V4.2z',
  file: ['M3.2 2.4h6.3l3.1 3.1v8.1a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1z', 'M9.5 2.4v3.1h3.1'],
  upload: 'M8 9.6V4M5.4 6.6 8 4l2.6 2.6M2.4 12.4v.6a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-.6',
  download: 'M8 2.6v5.8M5.4 6 8 8.6 10.6 6M2.4 12.4v.6a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-.6',
  expand: 'M2.6 6V2.6H6M9.6 2.6H13.4V6.4M13.4 10v3.4H9.6M6.4 13.4H2.6V9.6'
} as const;

/* ---------- контентные помощники ---------- */

function Lead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="help-lead">{children}</p>;
}

function P({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="help-p">{children}</p>;
}

function H2({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="help-h2">{children}</h2>;
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className="help-kbd">{children}</kbd>;
}

function Callout({
  kind = 'info',
  title,
  children
}: {
  kind?: 'info' | 'tip' | 'warn';
  title?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`help-callout help-callout--${kind}`}>
      {title && <div className="help-callout-title">{title}</div>}
      <div className="help-callout-body">{children}</div>
    </div>
  );
}

function Steps({
  items
}: {
  items: { t: string; d: React.ReactNode }[];
}): React.JSX.Element {
  return (
    <ol className="help-steps">
      {items.map((s, i) => (
        <li key={i} className="help-step">
          <span className="help-step-n">{i + 1}</span>
          <div>
            <div className="help-step-t">{s.t}</div>
            <div className="help-step-d">{s.d}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }): React.JSX.Element {
  return (
    <table className="help-table">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }): React.JSX.Element {
  return (
    <div className="help-faq">
      {items.map((it, i) => (
        <div key={i} className="help-faq-item">
          <div className="help-faq-q">{it.q}</div>
          <div className="help-faq-a">{it.a}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- схемы интерфейса ---------- */

function TerminalMock(): React.JSX.Element {
  return (
    <Mock label="Терминал: поиск, копирование и вставка" w={640} h={280}>
      <rect className="m-term" x="20" y="20" width="600" height="240" rx="6" />
      <T x={40} y={52} className="m-muted" mono size={11}>[root@web-01 ~]# systemctl status nginx</T>
      <T x={40} y={72} className="m-text" mono size={11}>● nginx.service - A high performance web server</T>
      <T x={40} y={92} className="m-ok" mono size={11}>   Active: active (running) since Mon 2026-08-17</T>
      <T x={40} y={112} className="m-text" mono size={11}>   Main PID: 1042 (nginx)</T>
      <T x={40} y={140} className="m-muted" mono size={11}>[root@web-01 ~]# _</T>

      {/* панель поиска */}
      <rect className="m-active" x="300" y="30" width="290" height="34" rx="6" stroke="var(--accent)" strokeWidth="1" />
      <T x={312} y={52} size={11}>nginx</T>
      <rect className="m-bg" x="548" y="36" width="16" height="16" rx="3" stroke="var(--border)" strokeWidth="1" />
      <IconPath x={549} y={37} d={ICON['chevron-up']} className="m-stroke-muted" />
      <rect className="m-bg" x="568" y="36" width="16" height="16" rx="3" stroke="var(--border)" strokeWidth="1" />
      <IconPath x={569} y={37} d={ICON['chevron-down']} className="m-stroke-muted" />

      <T x={40} y={200} className="m-text" mono size={11}>Ctrl+F — поиск · правая кнопка — вставить из буфера</T>
      <T x={40} y={220} className="m-muted" mono size={11}>Ctrl+Shift+C — копировать · Ctrl+Shift+V — вставить</T>
    </Mock>
  );
}

function SessionsMock(): React.JSX.Element {
  return (
    <Mock label="RDP, VNC и SFTP" w={640} h={300}>
      {/* RDP */}
      <rect className="m-raised" x="20" y="20" width="192" height="260" rx="6" />
      <T x={36} y={52} size={26}>🖥</T>
      <T x={36} y={74} weight={600} size={12}>RDP (Windows)</T>
      <T x={36} y={98} className="m-muted" size={11}>Рабочий стол открывается</T>
      <T x={36} y={112} className="m-muted" size={11}>прямо во вкладке.</T>
      <T x={36} y={136} className="m-muted" size={11}>Закрытие вкладки</T>
      <T x={36} y={150} className="m-muted" size={11}>закрывает и сессию.</T>
      <rect className="m-active" x={36} y={168} width={80} height={20} rx="4" />
      <T x={44} y={182} size={9}>Перезапуск</T>

      {/* VNC */}
      <rect className="m-raised" x="224" y="20" width="192" height="260" rx="6" />
      <T x={240} y={52} className="m-accent" size={12}>VNC · сервер</T>
      <rect className="m-term" x={236} y="60" width="168" height="180" rx="4" />
      <rect className="m-bg" x={268} y={120} width="104" height="60" rx="4" stroke="var(--border)" strokeWidth="1" />
      <T x={286} y={156} className="m-muted" size={10}>рабочий стол</T>
      <rect className="m-active" x={240} y={248} width={160} height={20} rx="4" />
      <IconPath x={252} y={248} d={ICON.expand} className="m-stroke-text" w={1.2} />
      <T x={268} y={262} size={9}>Полный экран</T>

      {/* SFTP */}
      <rect className="m-raised" x="428" y="20" width="192" height="260" rx="6" />
      <T x={444} y={52} weight={600} size={12}>SFTP</T>
      <rect className="m-bg" x="436" y="60" width="86" height="190" rx="4" stroke="var(--border)" strokeWidth="1" />
      <T x={444} y={78} className="m-muted" size={9}>Локально</T>
      <IconPath x={444} y={80} d={ICON.folder} className="m-stroke-warn" w={1.2} />
      <T x={462} y={96} size={10}>папка/</T>
      <IconPath x={444} y={96} d={ICON.file} className="m-stroke-muted" w={1.2} />
      <T x={462} y={112} size={10}>файл.txt</T>
      <rect className="m-bg" x="526" y="60" width="86" height="190" rx="4" stroke="var(--accent)" strokeWidth="1" />
      <T x={534} y={78} className="m-muted" size={9}>Сервер</T>
      <IconPath x={534} y={80} d={ICON.folder} className="m-stroke-warn" w={1.2} />
      <T x={552} y={96} size={10}>var/</T>
      <IconPath x={534} y={96} d={ICON.file} className="m-stroke-muted" w={1.2} />
      <T x={552} y={112} size={10}>app.log</T>
      <IconPath x={444} y={254} d={ICON.upload} className="m-stroke-muted" w={1.2} />
      <T x={462} y={270} className="m-muted" size={10}>загрузка ·</T>
      <IconPath x={514} y={254} d={ICON.download} className="m-stroke-muted" w={1.2} />
      <T x={532} y={270} className="m-muted" size={10}>скачивание</T>
    </Mock>
  );
}

function MenuMock(): React.JSX.Element {
  return (
    <Mock label="Меню приложения" w={640} h={260}>
      <rect className="m-raised" x="0" y="0" width="640" height="28" />
      <T x={12} y={19} size={12}>Файл</T>
      <T x={56} y={19} size={12}>Вид</T>
      <rect className="m-active" x={96} y={0} width="68" height="28" />
      <T x={108} y={19} weight={600} size={12}>Помощь</T>

      <rect className="m-active" x="96" y="28" width="260" height="176" rx="6" />
      <T x={112} y={54} size={12} weight={600}>Справка</T>
      <T x={330} y={54} className="m-muted" size={11}>F1</T>
      <T x={112} y={80} size={12}>Мастер настройки</T>
      <T x={330} y={80} className="m-muted" size={11}>F2</T>
      <T x={112} y={106} size={12}>Горячие клавиши</T>
      <T x={330} y={106} className="m-muted" size={11}>F3</T>
      <T x={112} y={132} size={12}>Настройки</T>
      <line className="m-line" x1={112} y1={144} x2={340} y2={144} />
      <T x={112} y={168} size={12}>О программе</T>

      <T x={420} y={80} className="m-muted" size={12}>F1 в любой момент открывает</T>
      <T x={420} y={96} className="m-muted" size={12}>этот раздел справки.</T>
    </Mock>
  );
}

function DiagnosticsMock(): React.JSX.Element {
  const row = (y: number, label: string): React.JSX.Element => (
    <g>
      <rect className="m-raised" x="40" y={y} width="260" height="36" rx="6" stroke="var(--border)" strokeWidth="1" />
      <T x={52} y={y + 23} size={11.5}>{label}</T>
    </g>
  );
  const branch = (y: number, text: string): React.JSX.Element => (
    <g>
      <line className="m-line" x1="300" y1={y} x2="338" y2={y} strokeDasharray="4 3" />
      <T x={348} y={y + 4} className="m-danger" size={11}>{text}</T>
    </g>
  );
  return (
    <Mock label="Диагностика подключения: порядок проверок" w={640} h={380}>
      {row(30, '1. Хост отвечает? (ping)')}
      {branch(48, 'нет → адрес, VPN, сеть')}
      <IconPath x={156} y={84} d={ICON['arrow-down']} className="m-stroke-muted" w={1.3} />
      {row(100, '2. Порт открыт? (TCP)')}
      {branch(118, 'нет → порт, фаервол')}
      <IconPath x={156} y={154} d={ICON['arrow-down']} className="m-stroke-muted" w={1.3} />
      {row(170, '3. Логин и пароль верны?')}
      {branch(188, 'нет → учётные данные')}
      <IconPath x={156} y={224} d={ICON['arrow-down']} className="m-stroke-muted" w={1.3} />
      <rect className="m-ok" x="40" y="240" width="260" height="36" rx="6" />
      <T x={52} y={263} className="m-white" size={11.5} weight={600}>4. Сессия открыта</T>
      <IconPath x={150} y={251} d={ICON.check} className="m-stroke-white" w={1.3} />
      <T x={40} y={310} className="m-muted" size={11}>«Проверить доступность» и ↻ выполняют шаги 1–2 автоматически.</T>
      <T x={40} y={330} className="m-muted" size={11}>Жёлтая точка на вкладке означает шаг 3 — нужен пароль.</T>
    </Mock>
  );
}

/* ---------- разделы справки ---------- */

export interface HelpSection {
  id: string;
  title: string;
  icon: string;
  keywords: string;
  body: React.JSX.Element;
}

const HOTKEYS: [string, string][] = [
  ['Ctrl+Shift+T', 'Новая сессия (диалог выбора хоста)'],
  ['Ctrl+W', 'Закрыть активную вкладку'],
  ['Ctrl+Tab', 'Следующая вкладка'],
  ['Ctrl+1…9', 'Переключиться на вкладку по номеру'],
  ['Ctrl+F', 'Поиск в выводе терминала'],
  ['Ctrl+= / Ctrl+-', 'Увеличить / уменьшить шрифт терминала'],
  ['Ctrl+Shift+C', 'Копировать выделение из терминала'],
  ['Ctrl+Shift+V', 'Вставить в терминал'],
  ['Правая кнопка мыши', 'Вставить из буфера в терминал'],
  ['Enter', 'Быстрое подключение / подтверждение'],
  ['Esc', 'Закрыть диалог или тултип'],
  ['Двойной клик по хосту', 'Открыть сессию'],
  ['Средняя кнопка по вкладке', 'Закрыть вкладку'],
  ['F1', 'Открыть справку'],
  ['F2', 'Запустить мастер настройки (тур)'],
  ['F3', 'Показать горячие клавиши']
];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'intro',
    title: 'Обзор интерфейса',
    icon: '⌂',
    keywords: 'главное окно интерфейс обзор панели схема что где',
    body: (
      <>
        <Lead>
          Remote Hub — один рабочий стол для ваших серверов. Он объединяет пять протоколов: SSH, Telnet, RDP,
          VNC и SFTP — в едином дереве профилей.
        </Lead>
        <Shot src={overviewShot} label="Главное окно Remote Hub" />
        <P>
          Слева — дерево профилей с поиском и тегами. Сверху — панель вкладок с инструментами и быстрым подключением.
          В центре — рабочая область (терминал, VNC, SFTP или статус RDP). Снизу — строка состояния.
        </P>
        <H2>Что умеет каждый протокол</H2>
        <Table
          head={['Протокол', 'Порт', 'Что это']}
          rows={[
            ['SSH', '22', 'Защищённый терминал (основной сценарий).'],
            ['Telnet', '23', 'Терминал без шифрования — для старых устройств.'],
            ['RDP', '3389', 'Удалённый рабочий стол Windows — встроен во вкладку.'],
            ['VNC', '5900', 'Удалённый рабочий стол, встроенный прямо во вкладку.'],
            ['SFTP', '—', 'Передача файлов; доступен для хостов SSH.']
          ]}
        />
        <Callout kind="tip" title="Быстрый старт">
          Откройте <Kbd>F1</Kbd> для справки, <Kbd>F2</Kbd> — для интерактивного тура с подсветкой элементов,{' '}
          <Kbd>F3</Kbd> — для списка горячих клавиш.
        </Callout>
      </>
    )
  },
  {
    id: 'first-steps',
    title: 'Первые шаги',
    icon: '▶',
    keywords: 'начало первый запуск добавить хост подключиться как начать',
    body: (
      <>
        <Lead>Самый быстрый путь от пустого окна до работающей сессии — четыре шага.</Lead>
        <Steps
          items={[
            {
              t: 'Добавьте хост',
              d: (
                <>
                  Нажмите <Kbd>＋ Хост</Kbd> внизу левой панели или выберите{' '}
                  <Kbd>Файл → Новая сессия</Kbd>.
                </>
              )
            },
            {
              t: 'Заполните профиль',
              d: (
                <>
                  Укажите имя, протокол, адрес и порт. Для SSH добавьте пользователя. Пароль можно ввести позже —{' '}
                  приложение спросит его при подключении.
                </>
              )
            },
            {
              t: 'Подключитесь',
              d: (
                <>
                  Дважды кликните по хосту в дереве — откроется вкладка с сессией. Статус виден в строке состояния
                  и по цветной точке на вкладке.
                </>
              )
            },
            {
              t: 'Или подключитесь сразу',
              d: (
                <>
                  Введите <Kbd>user@host</Kbd> в поле быстрого подключения вверху и нажмите <Kbd>Enter</Kbd> — профиль
                  создавать не обязательно. Вкладку можно сохранить кнопкой 💾.
                </>
              )
            }
          ]}
        />
        <Shot src={hostDialogShot} label="Диалог нового хоста" />
        <Callout kind="info" title="Что вводить">
          Формат быстрого подключения: <Kbd>user@host</Kbd>, <Kbd>user@host:2222</Kbd>, <Kbd>host</Kbd> или{' '}
          <Kbd>[::1]:22</Kbd> для IPv6. Если порт не указан, используется 22 (SSH).
        </Callout>
      </>
    )
  },
  {
    id: 'profiles',
    title: 'Профили и дерево',
    icon: '▣',
    keywords: 'профили дерево группа хост теги поиск импорт экспорт перетащить',
    body: (
      <>
        <Lead>Левая панель хранит все ваши серверы в виде дерева: группы — это папки, хосты — записи о серверах.</Lead>
        <Shot src={treeShot} label="Дерево профилей и контекстное меню" />
        <H2>Группы и хосты</H2>
        <P>
          Клик по группе сворачивает или разворачивает её. Группу можно вкладывать в группу. Кнопки внизу панели:
        </P>
        <Table
          head={['Кнопка', 'Действие']}
          rows={[
            ['＋ Группа', 'Создать папку для серверов.'],
            ['＋ Хост', 'Добавить сервер (диалог с полями протокола).'],
            ['Импорт', 'Загрузить дерево профилей из JSON-файла (слить или заменить).'],
            ['Экспорт', 'Сохранить текущее дерево в JSON-файл.'],
            ['🔑 Учётные данные', 'Управлять паролями и SSH-ключами.'],
            ['⚙ Настройки', 'Тема, шрифт, акцентный цвет и поведение.']
          ]}
        />
        <H2>Поиск и теги</H2>
        <P>
          Поле поиска ищет по имени, адресу и тегу. Выпадающий список «Все теги» фильтрует дерево по конкретному тегу.
          Теги задаются в диалоге хоста через запятую.
        </P>
        <H2>Перемещение</H2>
        <P>
          Хосты и группы можно перетаскивать мышью: на группу — чтобы вложить, на пустое место — чтобы вернуть в корень.
        </P>
        <Callout kind="tip" title="Совет">
          Правый клик по элементу открывает контекстное меню — переименование, дублирование и другие действия.
        </Callout>
      </>
    )
  },
  {
    id: 'context',
    title: 'Контекстное меню и доступность',
    icon: '☰',
    keywords: 'контекстное меню правый клик доступность ping порт проверить',
    body: (
      <>
        <Lead>
          Правый клик по группе или хосту открывает меню действий. Для хостов доступна проверка доступности — без
          подключения.
        </Lead>
        <Shot src={availabilityShot} label="Проверка доступности хоста" />
        <H2>Меню хоста</H2>
        <Table
          head={['Пункт', 'Действие']}
          rows={[
            ['Подключить', 'Открыть сессию (как двойной клик).'],
            ['SFTP', 'Открыть файловый менеджер (только для SSH).'],
            ['Проверить доступность', 'Проверить TCP-порт и ping, показать время ответа.'],
            ['Изменить…', 'Открыть диалог редактирования хоста.'],
            ['Дублировать', 'Создать копию хоста.'],
            ['Удалить', 'Удалить хост (с подтверждением).']
          ]}
        />
        <H2>Меню группы</H2>
        <Table
          head={['Пункт', 'Действие']}
          rows={[
            ['Добавить хост сюда…', 'Создать хост внутри группы.'],
            ['Добавить группу сюда…', 'Создать вложенную группу.'],
            ['Переименовать…', 'Изменить имя группы.'],
            ['Удалить', 'Удалить группу со всем содержимым.']
          ]}
        />
        <H2>Массовая проверка</H2>
        <P>
          Кнопка <Kbd>↻</Kbd> рядом с заголовком «Профили» проверяет все хосты сразу: TCP-порт и ping. Пока идёт
          проверка, кнопка меняется на <Kbd>■</Kbd> — нажмите её, чтобы остановить.
        </P>
        <P>
          Результат виден точкой слева от имени хоста: <span className="help-inline-dot help-inline-dot--ok" /> доступен,{' '}
          <span className="help-inline-dot help-inline-dot--fail" /> недоступен,{' '}
          <span className="help-inline-dot help-inline-dot--busy" /> проверяется.
        </P>
      </>
    )
  },
  {
    id: 'tabs',
    title: 'Вкладки и инструменты',
    icon: '▤',
    keywords: 'вкладки тунели сниппеты быстрое подключение статус точка',
    body: (
      <>
        <Lead>Каждая сессия — это вкладка. Панель вкладок также содержит инструменты и поле быстрого подключения.</Lead>
        <Shot src={snipsShot} label="Панель вкладок и поповер сниппетов" />
        <Shot src={newSessionShot} label="Диалог «Новая сессия»" />
        <H2>Управление вкладками</H2>
        <P>
          Переключайтесь <Kbd>Ctrl+Tab</Kbd> или <Kbd>Ctrl+1…9</Kbd>, закрывайте <Kbd>Ctrl+W</Kbd> или средней кнопкой
          мыши. Цветная точка слева показывает состояние сессии.
        </P>
        <H2>Инструменты</H2>
        <Table
          head={['Кнопка', 'Что делает']}
          rows={[
            ['＋', 'Новая сессия — диалог со списком всех хостов (Ctrl+Shift+T).'],
            ['⧉ Туннели', 'Порт-форвардинг через SSH: локальный порт → целевой хост:порт.'],
            ['Σ Сниппеты', 'Сохранённые команды — вставляются в активный терминал одним кликом.']
          ]}
        />
        <Callout kind="info" title="Туннели">
          Кнопка ⧉ появляется, только когда активна SSH-сессия. Туннели живут, пока открыта сессия, и закрываются вместе
          с ней.
        </Callout>
        <Callout kind="tip" title="Сниппеты">
          Команда вставляется без нажатия Enter — вы сами решаете, когда её запустить. Управление — через пункт
          «Управление сниппетами…» внизу поповера.
        </Callout>
      </>
    )
  },
  {
    id: 'terminal',
    title: 'Терминал (SSH/Telnet)',
    icon: '❯_',
    keywords: 'терминал ssh telnet поиск копировать вставить шрифт',
    body: (
      <>
        <Lead>
          Терминал работает через xterm.js внутри вкладки — без внешних окон. SSH использует шифрование, Telnet — нет.
        </Lead>
        <TerminalMock />
        <H2>Поиск по выводу</H2>
        <P>
          <Kbd>Ctrl+F</Kbd> открывает панель поиска. <Kbd>Enter</Kbd> ищет дальше, <Kbd>Shift+Enter</Kbd> — назад,{' '}
          <Kbd>Esc</Kbd> закрывает.
        </P>
        <H2>Копирование и вставка</H2>
        <P>
          Выделите текст мышью, затем <Kbd>Ctrl+Shift+C</Kbd> — скопировать. Вставка — <Kbd>Ctrl+Shift+V</Kbd> или
          правая кнопка мыши (вставляет содержимое буфера обмена).
        </P>
        <H2>Шрифт</H2>
        <P>
          Размер меняется на лету клавишами <Kbd>Ctrl+=</Kbd> и <Kbd>Ctrl+-</Kbd>, а шрифт и тему можно выбрать в
          настройках.
        </P>
        <Callout kind="warn" title="Telnet не шифруется">
          Telnet передаёт всё, включая пароли, открытым текстом. Используйте его только в доверенных сетях.
        </Callout>
      </>
    )
  },
  {
    id: 'sessions',
    title: 'RDP, VNC и SFTP',
    icon: '🖥',
    keywords: 'rdp vnc sftp рабочий стол файлы mstsc novnc передача',
    body: (
      <>
        <Lead>Три «тяжёлых» протокола используют свои встроенные панели внутри вкладок.</Lead>
        <SessionsMock />
        <H2>RDP</H2>
        <P>
          RDP встраивается прямо во вкладку: рабочий стол Windows открывается внутри приложения, следует за размером
          рабочей области и закрывается вместе с вкладкой. Профили с полным экраном и несколькими мониторами тоже
          используют одну встроенную сцену приложения: multi-monitor адаптируется к рабочей области, чтобы отдельное
          окно Remote Desktop не появлялось.
        </P>
        <P>
          Разрешение и режим меняются прямо во вкладке: выпадающий список вверху выбирает разрешение, а кнопка
          «На весь рабочий экран» разворачивает RDP внутри главного окна. Повторное нажатие возвращает оконный режим
          внутри той же вкладки.
        </P>
        <P>
          Предупреждение о недоверенном сертификате по умолчанию подтверждается автоматически. В настройках
          (⚙ Настройки → «Авто-подтверждать сертификат RDP») можно отключить это — тогда предупреждение будет
          показываться при каждом подключении, и вы решаете сами.
        </P>
        <H2>VNC</H2>
        <P>
          VNC встраивается прямо во вкладку (noVNC). Кнопка <Kbd>⛶ Полный экран</Kbd> разворачивает картинку.
          Масштаб и качество настраиваются в диалоге хоста.
        </P>
        <H2>SFTP</H2>
        <P>
          SFTP открывает две колонки: «Локально» и «Сервер». Двойной клик по папке — войти, по файлу — скачать.
          Кнопки в шапке колонки: обновить, вверх, загрузить на сервер, создать папку. Для строки доступны
          переименование и удаление.
        </P>
        <Callout kind="info" title="Как открыть SFTP">
          Правый клик по SSH-хосту → <Kbd>SFTP</Kbd>. Передачи файлов показывают прогресс внизу панели.
        </Callout>
      </>
    )
  },
  {
    id: 'troubleshooting',
    title: 'Частые вопросы и устранение неполадок',
    icon: '⚠',
    keywords: 'faq частые вопросы устранение неполадок диагностика ошибка не подключается порт доступность фаервол таймаут ключ',
    body: (
      <>
        <Lead>
          Не получается подключиться? Проверьте три вещи по порядку — адрес, порт и учётные данные. Обычно этого
          достаточно, чтобы найти причину.
        </Lead>
        <DiagnosticsMock />
        <H2>Диагностика по шагам</H2>
        <Steps
          items={[
            {
              t: 'Проверьте доступность',
              d: (
                <>
                  Правый клик по хосту → <Kbd>Проверить доступность</Kbd>. Он покажет, отвечает ли адрес (ping) и открыт
                  ли порт (TCP). Для всех хостов сразу — кнопка <Kbd>↻</Kbd> в заголовке «Профили».
                </>
              )
            },
            {
              t: 'Убедитесь в порту',
              d: (
                <>
                  Порты по умолчанию: SSH 22, Telnet 23, RDP 3389, VNC 5900. Если порт изменён, укажите его в профиле
                  хоста.
                </>
              )
            },
            {
              t: 'Проверьте учётные данные',
              d: (
                <>
                  Жёлтая точка на вкладке означает «нужен пароль». Проверьте имя пользователя, пароль или SSH-ключ и
                  привязанный набор учётных данных.
                </>
              )
            },
            {
              t: 'Настройки протокола',
              d: (
                <>
                  Для SSH увеличьте таймаут и включите keep-alive, для RDP проверьте домен, для VNC — качество и
                  масштаб. Всё это поля в диалоге хоста.
                </>
              )
            },
            {
              t: 'Сеть и фаервол',
              d: (
                <>
                  Убедитесь, что вы в нужной сети или VPN, фаервол пропускает порт, а IPv6-адрес указан в квадратных
                  скобках: <Kbd>[::1]:22</Kbd>.
                </>
              )
            }
          ]}
        />
        <Shot src={sessionErrorShot} label="Так выглядит ошибка подключения" />
        <H2>Частые вопросы</H2>
        <Faq
          items={[
            {
              q: 'При подключении сразу «Ошибка» или порт закрыт.',
              a: (
                <>
                  Правый клик по хосту → <Kbd>Проверить доступность</Kbd>. Если ping «недоступен» — проверьте адрес,
                  сеть и VPN. Если ping отвечает, а TCP-порт закрыт — проверьте номер порта и фаервол на сервере.
                </>
              )
            },
            {
              q: 'Вкладка показывает жёлтую точку «Нужен пароль», хотя пароль вводился.',
              a: (
                <>
                  Проверьте имя пользователя и привязанный набор учётных данных. При входе по ключу — путь к файлу
                  ключа и парольную фразу.
                </>
              )
            },
            {
              q: 'SSH-ключ не принимается.',
              a: (
                <>
                  Убедитесь, что выбран правильный файл ключа и верна парольная фраза, а на сервере ключ добавлен в{' '}
                  <Kbd>authorized_keys</Kbd>. Альтернатива — включить «Использовать SSH-агент» (Windows OpenSSH).
                </>
              )
            },
            {
              q: 'RDP не встраивается во вкладку — что проверить?',
              a: (
                <>
                  Любой режим RDP, включая полный экран и все мониторы, должен оставаться внутри вкладки. Если рабочий
                  стол не появился, проверьте порт 3389, домен, разрешение и опцию «Всегда спрашивать учётные данные»
                  в профиле хоста. При ошибке запуска вкладка покажет причину и кнопку переподключения.
                </>
              )
            },
            {
              q: 'VNC показывает чёрный экран или ошибку безопасности.',
              a: (
                <>
                  Проверьте порт (обычно 5900) и наличие пароля в профиле. При медленной сети уменьшите качество, а
                  масштаб выберите в диалоге хоста.
                </>
              )
            },
            {
              q: 'SFTP не открывается: «Не удалось открыть SFTP».',
              a: (
                <>
                  SFTP доступен только для хостов SSH. Убедитесь, что на порту 22 работает именно SSH-сервер.
                </>
              )
            },
            {
              q: 'Туннель не создаётся или сразу «остановлен».',
              a: (
                <>
                  Локальный порт может быть занят, либо целевой хост:порт недоступен с SSH-сервера. Туннель живёт,
                  пока открыта SSH-сессия.
                </>
              )
            },
            {
              q: 'Соединение рвётся или работает медленно.',
              a: (
                <>
                  Для SSH увеличьте таймаут и включите keep-alive в профиле. Для VNC уменьшите качество. Проверьте
                  стабильность сети и VPN.
                </>
              )
            },
            {
              q: 'Что означают цветные точки на вкладке?',
              a: (
                <>
                  Зелёная — подключено, синяя — подключение, жёлтая — нужен пароль, красная — ошибка, серая — закрыто.
                  Тот же статус виден в строке состояния.
                </>
              )
            }
          ]}
        />
      </>
    )
  },
  {
    id: 'credentials',
    title: 'Учётные данные и безопасность',
    icon: '🔑',
    keywords: 'учётные данные пароль ключ dpapi безопасность агент',
    body: (
      <>
        <Lead>
          Наборы учётных данных — переиспользуемые пары «пользователь + пароль/ключ», которые привязываются к хостам.
        </Lead>
        <Shot src={credentialsShot} label="Наборы учётных данных" />
        <H2>Как это работает</H2>
        <P>
          Создайте набор в разделе <Kbd>🔑 Учётные данные</Kbd>, затем выберите его в диалоге хоста. Один набор можно
          привязать к любому числу хостов — при изменении набора обновятся все сразу.
        </P>
        <H2>Хранение паролей</H2>
        <P>
          Сохранённые пароли и парольные фразы ключей шифруются средствами Windows (DPAPI) и не показываются в
          интерфейсе. Альтернатива — режим «Спрашивать при подключении»: пароль не хранится и запрашивается каждый раз.
        </P>
        <H2>SSH-ключи и агент</H2>
        <P>
          К набору можно прикрепить файл SSH-ключа и парольную фразу к нему. Опция «Использовать SSH-агент» задействует
          Windows OpenSSH-агент вместо файла.
        </P>
        <Callout kind="tip" title="Рекомендация">
          Для однотипных серверов заведите один набор и привяжите его ко всем хостам — так проще обновлять пароли.
        </Callout>
      </>
    )
  },
  {
    id: 'settings',
    title: 'Настройки',
    icon: '⚙',
    keywords: 'настройки тема светлая тёмная шрифт размер акцентный цвет подтверждение вкладки',
    body: (
      <>
        <Lead>Настройки открываются кнопкой ⚙ внизу левой панели или через меню «Помощь → Настройки».</Lead>
        <Shot src={settingsShot} label="Панель настроек" />
        <Table
          head={['Настройка', 'Описание']}
          rows={[
            ['Тема', 'Тёмная или светлая — применяется ко всему приложению сразу.'],
            ['Шрифт терминала', 'Один из шести моноширинных шрифтов; недоступные помечаются.'],
            ['Размер шрифта', 'От 10 до 22 px, меняется также Ctrl+= / Ctrl+-.'],
            ['Акцентный цвет', 'Шесть цветов для кнопок, подсветки и активных элементов.'],
            ['Подтверждать удаление', 'Спрашивать перед удалением профилей и закрытием активных вкладок.'],
            ['Восстанавливать вкладки', 'Открывать терминальные вкладки заново после перезапуска.']
          ]}
        />
        <Callout kind="tip" title="Всё применяется мгновенно">
          Ни одна настройка не требует перезапуска — изменения видны сразу.
        </Callout>
      </>
    )
  },
  {
    id: 'hotkeys',
    title: 'Горячие клавиши',
    icon: '⌨',
    keywords: 'горячие клавиши сочетания шорткаты быстрые',
    body: (
      <>
        <Lead>Полный список сочетаний клавиш. Доступен также по <Kbd>F3</Kbd>.</Lead>
        <Table
          head={['Сочетание', 'Действие']}
          rows={HOTKEYS.map(([k, d]) => [<Kbd key={k}>{k}</Kbd>, d])}
        />
      </>
    )
  },
  {
    id: 'menu',
    title: 'Меню приложения',
    icon: '☰',
    keywords: 'меню файл вид помощь о программе новая сессия выход перезагрузить',
    body: (
      <>
        <Lead>Каждый пункт системного меню — что он делает и куда ведёт.</Lead>
        <MenuMock />
        <Table
          head={['Меню', 'Пункт', 'Действие']}
          rows={[
            ['Файл', 'Новая сессия (Ctrl+Shift+T)', 'Диалог выбора хоста с поиском по дереву.'],
            ['Файл', 'Выход', 'Закрыть приложение и все сессии.'],
            ['Вид', 'Перезагрузить', 'Перезагрузить интерфейс (аналог обновления страницы).'],
            ['Вид', 'Инструменты разработчика', 'Открыть DevTools для отладки.'],
            ['Помощь', 'Справка (F1)', 'Открыть этот раздел.'],
            ['Помощь', 'Мастер настройки (F2)', 'Интерактивный тур с подсветкой элементов.'],
            ['Помощь', 'Горячие клавиши (F3)', 'Быстрый список сочетаний.'],
            ['Помощь', 'Настройки', 'Открыть панель настроек в левой колонке.'],
            ['Помощь', 'О программе', 'Версия, версия Electron и ссылка на репозиторий.']
          ]}
        />
        <Callout kind="info" title="Подсказка">
          Горячие клавиши из меню работают в любом месте приложения, кроме полей ввода.
        </Callout>
      </>
    )
  }
];

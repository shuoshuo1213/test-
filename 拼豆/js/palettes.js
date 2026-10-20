/* ============================================================
 * 拼豆工坊 · 内置色卡
 * 说明：HEX 为「屏幕参考值」，不同批次、显示器与光线会有色差，
 *      下单前请以实体色卡为准。你也可以导入自己买的色卡（见 README）。
 * 色号命名：品类前缀 + 序号，方便按色系找豆。
 * ============================================================ */
(function (g) {
  'use strict';

  const C = g.PBColor;

  const toColor = (arr) => arr.map(([code, name, hex]) => {
    const rgb = C.hexToRgb(hex);
    return { code, name, hex: hex.toUpperCase(), r: rgb.r, g: rgb.g, b: rgb.b };
  });

  /* ---------------- 通用 84 色 ---------------- */
  const UNIVERSAL = toColor([
    /* 中性色 */
    ['WH-01', '纯白', '#FFFFFF'],
    ['WH-02', '米白', '#F6F1E4'],
    ['WH-03', '象牙白', '#EFE7D3'],
    ['WH-04', '珍珠白', '#F1EEF6'],
    ['GY-01', '浅灰', '#DCDEE1'],
    ['GY-02', '银灰', '#BEC3C9'],
    ['GY-03', '中灰', '#989EA6'],
    ['GY-04', '深灰', '#6E747C'],
    ['GY-05', '炭灰', '#4A4F56'],
    ['BK-01', '纯黑', '#1C1C1E'],
    ['BK-02', '墨灰', '#2E3238'],
    ['BR-01', '咖啡', '#6B4A32'],
    ['BR-02', '巧克力', '#43301F'],
    ['BR-03', '浅棕', '#A57A52'],
    /* 肤色 */
    ['SK-01', '白皙', '#FFE2CC'],
    ['SK-02', '浅肤', '#FFD0AE'],
    ['SK-03', '小麦', '#F0B98D'],
    ['SK-04', '蜜棕', '#D08D64'],
    ['SK-05', '深褐', '#9E6B45'],
    /* 红粉 */
    ['RD-01', '正红', '#E4352E'],
    ['RD-02', '大红', '#C81F24'],
    ['RD-03', '樱桃红', '#A81E37'],
    ['RD-04', '酒红', '#7C2033'],
    ['RD-05', '砖红', '#B5503F'],
    ['PK-01', '玫红', '#DC3E7E'],
    ['PK-02', '珊瑚粉', '#FF8E7A'],
    ['PK-03', '粉红', '#F9AEC5'],
    ['PK-04', '樱花粉', '#FFCADD'],
    ['PK-05', '浅粉', '#FFE3ED'],
    ['PK-06', '藕荷', '#E2B6D3'],
    ['PK-07', '桃粉', '#FFB59B'],
    /* 橙黄 */
    ['OR-01', '橙', '#F58220'],
    ['OR-02', '深橙', '#DF5F1B'],
    ['OR-03', '杏橙', '#FFBE85'],
    ['OR-04', '蜜桃', '#FFD8B4'],
    ['YL-01', '柠檬黄', '#FDE733'],
    ['YL-02', '正黄', '#FFD11A'],
    ['YL-03', '金黄', '#F3A62A'],
    ['YL-04', '奶油黄', '#FFF2B8'],
    ['YL-05', '香槟', '#EBD3A0'],
    /* 绿 */
    ['GR-01', '嫩绿', '#A8E05A'],
    ['GR-02', '草绿', '#6FC336'],
    ['GR-03', '抹茶', '#B7C97A'],
    ['GR-04', '橄榄', '#8C9A55'],
    ['GR-05', '军绿', '#5E7A3A'],
    ['GR-06', '墨绿', '#2E5836'],
    ['GR-07', '翡翠', '#12A96B'],
    ['GR-08', '孔雀绿', '#1C7A6B'],
    ['GR-09', '薄荷', '#A9E7CF'],
    ['GR-10', '松石绿', '#52C7B8'],
    ['GR-11', '灰绿', '#9FB49B'],
    /* 蓝 */
    ['BL-01', '冰蓝', '#CFE9F8'],
    ['BL-02', '天蓝', '#7FC7E8'],
    ['BL-03', '湖蓝', '#3FA9E8'],
    ['BL-04', '亮蓝', '#0C86D9'],
    ['BL-05', '宝蓝', '#22509E'],
    ['BL-06', '深蓝', '#1D3461'],
    ['BL-07', '藏青', '#17203A'],
    ['BL-08', '雾蓝', '#93A9C4'],
    ['BL-09', '牛仔蓝', '#4A6C8C'],
    ['BL-10', '星空蓝', '#6E7FC4'],
    ['BL-11', '蓝紫', '#5C63B5'],
    /* 紫 */
    ['PU-01', '淡紫', '#E6DCF7'],
    ['PU-02', '薰衣草', '#BFA6E6'],
    ['PU-03', '紫罗兰', '#8A63C4'],
    ['PU-04', '葡萄紫', '#6A3B8E'],
    ['PU-05', '深紫', '#472A6B'],
    ['PU-06', '灰紫', '#9C8AA5'],
    /* 特殊质感 */
    ['GD-01', '金色', '#C9A227'],
    ['GD-02', '香槟金', '#E4C878'],
    ['SV-01', '银色', '#C6CBD1'],
    ['FL-01', '荧光黄', '#EEFF3C'],
    ['FL-02', '荧光绿', '#77FF4C'],
    ['FL-03', '荧光橘', '#FF7A1F'],
    ['FL-04', '荧光粉', '#FF3E9C'],
    ['CL-01', '透明', '#E8F2F6'],
    /* 莫兰迪 / 奶茶 */
    ['NE-01', '燕麦', '#E7DBC7'],
    ['NE-02', '陶土', '#C97C63'],
    ['NE-03', '雾粉', '#E9C8C4'],
    ['NE-04', '灰蓝', '#A9C0CE'],
    ['NE-05', '浅卡其', '#D7CAB0'],
    ['NE-06', '雾霾绿', '#A8B5A2'],
    ['NE-07', '藕粉', '#D9BFC1'],
    ['NE-08', '雾霾紫', '#B7AAC4']
  ]);

  /* 简易挑选器：按色号前缀取子集 */
  function pick(list, codes) {
    const byCode = new Map(list.map((c) => [c.code, c]));
    return codes.map((code) => {
      const c = byCode.get(code);
      if (!c) throw new Error('色卡缺少色号 ' + code);
      return { code: c.code, name: c.name, hex: c.hex, r: c.r, g: c.g, b: c.b };
    });
  }

  /* ---------------- 新手 48 色 ---------------- */
  const STARTER = pick(UNIVERSAL, [
    'WH-01', 'WH-02', 'WH-04', 'GY-01', 'GY-03', 'GY-04',
    'BK-01', 'BR-01', 'BR-02', 'BR-03',
    'SK-01', 'SK-02', 'SK-03', 'SK-04', 'SK-05',
    'RD-01', 'RD-03', 'RD-04', 'PK-01', 'PK-02', 'PK-03', 'PK-04',
    'OR-01', 'OR-03', 'YL-02', 'YL-03', 'YL-04',
    'GR-01', 'GR-02', 'GR-06', 'GR-07', 'GR-09',
    'BL-01', 'BL-02', 'BL-04', 'BL-05', 'BL-06', 'BL-10',
    'PU-01', 'PU-02', 'PU-04',
    'GD-01', 'SV-01',
    'NE-01', 'NE-02', 'NE-03', 'NE-04', 'NE-06'
  ]);

  /* ---------------- 柔和马卡龙 36 色 ---------------- */
  const SOFT = pick(UNIVERSAL, [
    'WH-01', 'WH-02', 'WH-04', 'GY-01', 'GY-02', 'GY-03',
    'SK-01', 'SK-02', 'BR-03',
    'PK-03', 'PK-04', 'PK-05', 'PK-06', 'PK-07',
    'OR-03', 'OR-04', 'YL-04', 'YL-05',
    'GR-03', 'GR-09', 'GR-11',
    'BL-01', 'BL-08', 'BL-10',
    'PU-01', 'PU-02', 'PU-06',
    'NE-01', 'NE-02', 'NE-03', 'NE-04', 'NE-05', 'NE-06', 'NE-07', 'NE-08',
    'SV-01'
  ]);

  const SETS = [
    {
      id: 'universal',
      name: '通用 84 色',
      desc: '覆盖肤色、自然色、糖果色与莫兰迪色，适合绝大多数图片',
      colors: UNIVERSAL
    },
    {
      id: 'starter',
      name: '新手 48 色',
      desc: '从 84 色里挑出的常用色，买豆更省',
      colors: STARTER
    },
    {
      id: 'soft',
      name: '柔和马卡龙 36 色',
      desc: '低饱和，人物 / 风景 / 治愈系插画更好看',
      colors: SOFT
    }
  ];

  /* ---------------- 自定义色卡（localStorage） ---------------- */
  const STORE_KEY = 'pbg.customPalettes.v1';

  function loadCustom() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveCustom(list) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  /** 归一化一份色卡（容错：接受 {colors:[{code,name,hex}]} 或数组） */
  function normalize(raw, fallbackName) {
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.colors) ? raw.colors : null);
    if (!arr) throw new Error('色卡格式不正确：需要数组或 {colors:[...]}');
    const out = [];
    const seen = new Set();
    arr.forEach((item, i) => {
      let code = item.code || item.id || '';
      let name = item.name || item.label || '';
      let hex = item.hex || item.color || '';
      if (!hex && typeof item.r === 'number') hex = C.rgbToHex(item.r, item.g, item.b);
      const rgb = C.hexToRgb(hex);
      if (!rgb) return;
      if (!code) code = 'C' + String(i + 1).padStart(2, '0');
      if (!name) name = code;
      const norm = C.rgbToHex(rgb.r, rgb.g, rgb.b);
      if (seen.has(norm)) return;
      seen.add(norm);
      out.push({ code: String(code), name: String(name), hex: norm, r: rgb.r, g: rgb.g, b: rgb.b });
    });
    if (!out.length) throw new Error('没有解析到任何有效颜色');
    return {
      id: (raw && raw.id) || 'custom-' + Date.now().toString(36),
      name: (raw && raw.name) || fallbackName || '自定义色卡',
      desc: (raw && raw.desc) || '导入的色卡',
      colors: out
    };
  }

  /** 解析 CSV：每行 code,name,hex（允许表头，允许 # 开头） */
  function parseCsv(text) {
    const rows = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    rows.forEach((line, i) => {
      const parts = line.split(/[,;\t]/).map((s) => s.trim());
      const hex = parts.find((p) => /^#?[0-9a-fA-F]{6}$/.test(p) || /^#?[0-9a-fA-F]{3}$/.test(p));
      if (!hex) return; // 表头或空行
      const rest = parts.filter((p) => p !== hex);
      out.push({
        code: rest[0] || ('C' + String(i + 1).padStart(2, '0')),
        name: rest[1] || '',
        hex
      });
    });
    if (!out.length) throw new Error('CSV 里没找到形如 #RRGGBB 的颜色');
    return out;
  }

  g.PBPalettes = {
    SETS,
    UNIVERSAL,
    STARTER,
    SOFT,
    loadCustom,
    saveCustom,
    normalize,
    parseCsv
  };
})(typeof window !== 'undefined' ? window : globalThis);

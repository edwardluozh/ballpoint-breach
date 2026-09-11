/** 参考色板 —— 见 docs/REFERENCE_ANALYSIS.md §3 */
export const PAL = {
  paperWarm: 0xf6f0dc,
  paperCool: 0xecebdd,
  ink: 0x29277f,          // 靛蓝主墨
  inkSoft: 0x5a5aa8,      // 副线/淡线
  hatch: 0x8a86c4,        // 薰衣草蓝影线
  ochre: 0xd7a049,        // 施工点缀
  red: 0xc92f4f,          // 敌人/血
  mint: 0x77c990,         // 补给
  graphite: 0x3a3a3c,     // 面部
  paperWhite: 0xfdfbf1,   // NPC 纸白
} as const;

export const PAL_CSS = {
  ink: '#29277f',
  inkSoft: 'rgba(41,39,127,0.55)',
  red: '#c92f4f',
  graphite: '#3a3a3c',
  paper: '#f2ecdb',
} as const;

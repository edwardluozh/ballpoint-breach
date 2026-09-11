/** 五武器数值定义(弹药/节奏/伤害/抛壳时点)。 */
export type WeaponId = 'rifle' | 'shotgun' | 'revolver' | 'sniper' | 'katana';

export interface WeaponDef {
  id: WeaponId;
  slot: 1 | 2 | 3 | 4 | 5;
  label: string;
  note: string;
  magSize: number;
  reserveStart: number;
  reserveMax: number;
  auto: boolean;
  fireInterval: number;     // s
  damage: number;
  pellets: number;          // 霰弹 12
  spread: number;           // rad
  reloadTime: number;
  delayKind: 'none' | 'pump' | 'bolt';
  delayTime: number;        // 泵/栓延迟
  ejectAt: number;          // 抛壳时点(开火后 s);revolver = Infinity(留膛)
  recoilKick: number;       // viewmodel 后坐
  recoilCam: number;        // 相机上抬(rad)
  barricadeMul: number;
  melee?: boolean;
  blockable?: boolean;      // katana RMB 格挡
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle', slot: 1, label: '步枪', note: '全自动 · 用全息镜瞄准',
    magSize: 30, reserveStart: 150, reserveMax: 300, auto: true, fireInterval: 0.105,
    damage: 12, pellets: 1, spread: 0.011, reloadTime: 1.5, delayKind: 'none', delayTime: 0,
    ejectAt: 0.02, recoilKick: 0.035, recoilCam: 0.006, barricadeMul: 1,
  },
  shotgun: {
    id: 'shotgun', slot: 2, label: '霰弹枪', note: '泵动 · 近距离毁灭一切',
    magSize: 6, reserveStart: 30, reserveMax: 60, auto: false, fireInterval: 0.95,
    damage: 11, pellets: 12, spread: 0.055, reloadTime: 2.1, delayKind: 'pump', delayTime: 0.27,
    ejectAt: 0.27, recoilKick: 0.12, recoilCam: 0.028, barricadeMul: 2.6,
  },
  revolver: {
    id: 'revolver', slot: 3, label: '左轮', note: '手炮 · 爆头即抹除',
    magSize: 6, reserveStart: 36, reserveMax: 72, auto: false, fireInterval: 0.5,
    damage: 40, pellets: 1, spread: 0.004, reloadTime: 2.0, delayKind: 'none', delayTime: 0,
    ejectAt: Infinity, recoilKick: 0.14, recoilCam: 0.032, barricadeMul: 1.6,
  },
  sniper: {
    id: 'sniper', slot: 4, label: '狙击枪', note: '栓动开镜 · 一发一擦除',
    magSize: 5, reserveStart: 25, reserveMax: 50, auto: false, fireInterval: 1.3,
    damage: 110, pellets: 1, spread: 0.0008, reloadTime: 2.4, delayKind: 'bolt', delayTime: 0.31,
    ejectAt: 0.31, recoilKick: 0.16, recoilCam: 0.038, barricadeMul: 1.8,
  },
  katana: {
    id: 'katana', slot: 5, label: '武士刀', note: '斩击 · 按住右键格挡并反弹子弹',
    magSize: Infinity, reserveStart: 0, reserveMax: 0, auto: false, fireInterval: 0.62,
    damage: 65, pellets: 1, spread: 0, reloadTime: 0, delayKind: 'none', delayTime: 0,
    ejectAt: Infinity, recoilKick: 0.05, recoilCam: 0, barricadeMul: 3,
    melee: true, blockable: true,
  },
};

export const SLOT_ORDER: WeaponId[] = ['rifle', 'shotgun', 'revolver', 'sniper', 'katana'];

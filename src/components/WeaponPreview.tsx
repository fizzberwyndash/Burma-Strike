interface WeaponPreviewProps {
  kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'knife' | 'armor';
  armorPoints?: number;
  className?: string;
}

/** Original procedural side profiles; previews do not load or own Babylon resources. */
export default function WeaponPreview({ kind, armorPoints = 25, className = '' }: WeaponPreviewProps) {
  const graphite = '#354440';
  const inset = '#152722';
  const steel = '#69766a';
  const gold = '#c8a76b';
  return <svg className={`weapon-preview ${className}`} viewBox="0 0 400 150" aria-hidden="true" focusable="false">
    <g stroke="#b79c6430" strokeWidth=".7" fill="none">
      <path d="M20 112H380M20 38H380M54 18V133M346 18V133" />
      <path d="M24 70H34M29 65V75M366 70H376M371 65V75" />
    </g>
    <g stroke={steel} strokeWidth="1.4" strokeLinejoin="round">
      {kind === 'pistol' && <g transform="translate(105 26)">
        <path d="M18 21H185L193 29V46H82L72 55H26L18 46Z" fill={graphite} />
        <path d="M26 47H79L70 104H32L28 83L34 65H22Z" fill={inset} />
        <path d="M81 48H124L119 75H76M84 55V67H107L110 55" fill="none" />
        <path d="M34 29V43M41 29V43M48 29V43M55 29V43M62 29V43" stroke={inset} strokeWidth="3" />
        <path d="M79 23H151V27H79Z" fill={gold} stroke="none" />
        <path d="M33 101H70V108H33ZM173 17H182V21H173Z" fill={gold} />
        <path d="M42 73H64M41 81H62M40 89H60" stroke={steel} strokeWidth="2" />
      </g>}
      {(kind === 'smg' || kind === 'rifle' || kind === 'sniper') && <g transform={`translate(${kind === 'smg' ? 53 : 29} 20)`}>
        <path d={`M${kind === 'smg' ? 70 : 89} 37H${kind === 'smg' ? 215 : 244}L254 48V65H94L82 57H62V42Z`} fill={graphite} />
        <path d="M88 65H124L113 108H87L92 80H79Z" fill={inset} />
        <path d={kind === 'smg' ? 'M153 65H172V118H150Z' : 'M159 64H184L191 111L166 117L155 80Z'} fill={inset} />
        <path d="M123 65H149L146 86H116M129 69V78H139" fill="none" />
        <path d={kind === 'smg' ? 'M19 47H72V58H38L27 85H13Z' : 'M9 47H79V58H46L30 81H7Z'} fill={graphite} />
        <path d={`M253 47H${kind === 'smg' ? 290 : kind === 'sniper' ? 340 : 321}V56H253Z`} fill={steel} />
        <path d={`M${kind === 'smg' ? 284 : kind === 'sniper' ? 333 : 314} 44H${kind === 'smg' ? 300 : kind === 'sniper' ? 347 : 330}V59H${kind === 'smg' ? 284 : kind === 'sniper' ? 333 : 314}Z`} fill={inset} />
        <path d="M201 40V61M211 40V61M221 40V61M231 40V61" stroke={inset} strokeWidth="4" />
        <path d="M97 39H183M110 48H141" stroke={gold} strokeWidth="2" />
        <path d="M93 92H110M94 99H108M98 42V50" stroke={steel} />
        {kind === 'sniper' ? <g>
          <path d="M119 24H235V39H119ZM130 21H224V42H130Z" fill={graphite} />
          <path d="M115 21H132V42H115ZM225 19H244V44H225Z" fill={inset} />
          <path d="M171 16H186V24H171Z" fill={gold} />
          <path d="M148 40V47M211 40V47" stroke={gold} strokeWidth="4" />
        </g> : <g>
          <path d="M123 31H140V38H123ZM229 27H237V38H229Z" fill={gold} />
          {kind === 'smg' && <path d="M92 38L109 21H144L155 38M104 36L116 28H138L144 36" fill={inset} />}
        </g>}
        <path d="M167 112L189 107" stroke={gold} strokeWidth="4" />
      </g>}
      {kind === 'knife' && <g transform="translate(56 40) rotate(-7 140 35)">
        <path d="M123 17H267L304 33L268 48H123Z" fill={steel} />
        <path d="M124 24H264L289 33H123" fill="#a4afa0" stroke="none" />
        <path d="M119 18H250L219 26H119Z" fill={graphite} stroke="none" />
        <path d="M28 22H112V43H28L20 37V28Z" fill={inset} />
        <path d="M107 8H123V58H107ZM17 21H29V45H17Z" fill={gold} />
        <path d="M37 22L31 43M51 22L45 43M65 22L59 43M79 22L73 43M93 22L87 43" stroke={steel} strokeWidth="3" />
      </g>}
      {kind === 'armor' && <g transform="translate(143 10)">
        <path d="M17 15L36 5L57 17L78 5L97 15L109 46L96 58V123H18V58L5 46Z" fill={graphite} />
        <path d="M37 6L39 35H75L78 6M18 57H96M22 115H92" fill="none" stroke={gold} strokeWidth="2" />
        <path d="M31 48H83L88 77L78 103H36L26 77Z" fill={inset} />
        <path d="M36 57H78M32 69H82M34 81H80M39 93H75" stroke={steel} strokeWidth="3" />
        {armorPoints > 25 && <g fill={gold} stroke="none"><path d="M19 26H31V45H14ZM83 26H95L100 45H83Z" /><path d="M18 62H25V98H18ZM89 62H96V98H89Z" /></g>}
        <path d="M49 46L57 42L65 46V59L57 65L49 59Z" fill={gold} stroke="none" />
      </g>}
    </g>
  </svg>;
}

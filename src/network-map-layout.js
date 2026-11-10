/**
 * Drawing-only layout for the HUD network map.
 *
 * This table holds schematic coordinates only: where each station symbol, label,
 * chip row and track path is drawn. It contains no station names, line names,
 * colours, stop orders or line memberships. Those are always read from the live
 * game network (see network-map-model.js), and tests/network-map-data.mjs fails
 * if the drawing and the game network ever disagree.
 *
 * Geometry is taken from the approved reference map (map-physics-reference.html).
 * Coordinates are in map units on a 1330 × 1150 canvas.
 */
export const MAP_SIZE = Object.freeze({ width: 1330, height: 1150 });

/** Track centre-lines per line, as SVG path data. `variant` is an alternative route. */
export const LINE_PATHS = Object.freeze({
  U1: {
    main: "M 560 330 L 560 466 Q 560 480 569.9 489.9 L 590.1 510.1 Q 600 520 614 520 L 636 520 Q 650 520 664 520 L 746 520 Q 760 520 774 520 L 866 520 Q 880 520 894 520 L 996 520 Q 1010 520 1024 520 L 1140 520",
  },
  U2: {
    main: "M 230 430 L 266 430 Q 280 430 289.9 439.9 L 320.1 470.1 Q 330 480 344 480 L 386 480 Q 400 480 414 480 L 546 480 Q 560 480 574 480 L 676 480 Q 690 480 704 480 L 806 480 Q 820 480 834 480 L 936 480 Q 950 480 964 480 L 1140 480",
  },
  U3: {
    main: "M 440 360 L 550.1 470.1 Q 560 480 560 494 L 560 516 Q 560 530 569.9 539.9 L 710.1 680.1 Q 720 690 729.9 699.9 L 830.1 800.1 Q 840 810 849.9 819.9 L 910.1 880.1 Q 920 890 929.9 899.9 L 990.1 960.1 Q 1000 970 1009.9 979.9 L 1080 1050",
  },
  U4: {
    main: "M 110 560 L 246 560 Q 260 560 274 560 L 466 560 Q 480 560 489.9 550.1 L 550.1 489.9 Q 560 480 569.9 470.1 L 680.1 359.9 Q 690 350 704 350 L 1040 350",
  },
  U5: {
    main: "M 260 560 L 260 636 Q 260 650 260 664 L 260 726 Q 260 740 260 754 L 260 836 Q 260 850 269.9 859.9 L 330.1 920.1 Q 340 930 354 930 L 406 930 Q 420 930 420 944 L 420 951 Q 420 965 420 979 L 420 1096 Q 420 1110 429.9 1100.1 L 550.1 979.9 Q 560 970 560 956 L 560 864 Q 560 850 569.9 840.1 L 600.1 809.9 Q 610 800 619.9 790.1 L 720 690",
    variant: { id: "scenic", d: "M 650 760 L 720.1 830.1 Q 730 840 730 854 L 730 1016 Q 730 1030 730 1044 L 730 1086 Q 730 1100 744 1100 L 956 1100 Q 970 1100 970 1086 L 970 1069 Q 970 1055 970 1041 L 970 1024 Q 970 1010 956 1010 L 944 1010 Q 930 1010 916 1010 L 904 1010 Q 890 1010 890 1024 L 890 1074 Q 890 1088 876 1088 L 774 1088 Q 760 1088 760 1074 L 760 814 Q 760 800 750.1 790.1 L 685 725" },
  },
  U6: {
    main: "M 230 430 L 230 354 Q 230 340 230 326 L 230 264 Q 230 250 230 236 L 230 184 Q 230 170 244 170 L 366 170 Q 380 170 394 170 L 516 170 Q 530 170 544 170 L 676 170 Q 690 170 704 170 L 806 170 Q 820 170 834 170 L 936 170 Q 950 170 964 170 L 1026 170 Q 1040 170 1040 184 L 1040 350",
  },
  U9: {
    main: "M 560 515 L 509.9 565.1 Q 500 575 490.1 584.9 L 469.9 605.1 Q 460 615 460 629 L 460 686 Q 460 700 460 714 L 460 776 Q 460 790 460 804 L 460 856 Q 460 870 469.9 879.9 L 550.1 960.1 Q 560 970 574 970 L 656 970 Q 670 970 670 956 L 670 904 Q 670 890 660.1 880.1 L 639.9 859.9 Q 630 850 616 850 L 560 850",
  },
  U10: {
    main: "M 530 414 L 530 314 Q 530 300 530 286 L 530 184 Q 530 170 530 156 L 530 124 Q 530 110 530 96 L 530 84 Q 530 70 544 70 L 676 70 Q 690 70 704 70 L 806 70 Q 820 70 834 70 L 946 70 Q 960 70 974 70 L 1106 70 Q 1120 70 1120 84 L 1120 161 Q 1120 175 1120 189 L 1120 251 Q 1120 265 1120 279 L 1120 360",
    halo: true,
  },
});

/**
 * Station symbol centres and label anchors (SVG text baseline + text-anchor).
 * `chips` positions the row of line chips; which chips appear comes from game data.
 * `sub` positions a secondary label (platform exposure), whose text comes from game data.
 */
export const STATION_LAYOUT = Object.freeze({
  "station-1": { x: 560, y: 330, label: { x: 572, y: 334, anchor: "start" }, chips: { x: 632, y: 324, align: "start" } },
  "station-3": { x: 650, y: 520, label: { x: 650, y: 538, anchor: "middle" } },
  "u1-lindenallee": { x: 760, y: 520, label: { x: 760, y: 538, anchor: "middle" } },
  "u1-universitaetsviertel": { x: 880, y: 520, label: { x: 880, y: 538, anchor: "middle" } },
  "u1-botanischer-garten": { x: 1010, y: 520, label: { x: 1010, y: 538, anchor: "middle" } },
  "u1-ostgaerten": { x: 1140, y: 520, label: { x: 1154, y: 524, anchor: "start" }, chips: { x: 1222, y: 512, align: "start" } },
  "u2-stadtzentrum": { x: 230, y: 430, label: { x: 218, y: 434, anchor: "end" }, chips: { x: 218, y: 442, align: "end" } },
  "u2-rathausmarkt": { x: 400, y: 480, label: { x: 400, y: 470, anchor: "middle" } },
  "u2-kupfergasse": { x: 690, y: 480, label: { x: 690, y: 470, anchor: "middle" } },
  "u2-schwarzkopf": { x: 820, y: 480, label: { x: 820, y: 470, anchor: "middle" } },
  "u2-stahlhof": { x: 950, y: 480, label: { x: 950, y: 470, anchor: "middle" } },
  "u2-eisenwerk": { x: 1140, y: 480, label: { x: 1154, y: 484, anchor: "start" }, chips: { x: 1222, y: 472, align: "start" } },
  "u3-schattenufer": { x: 440, y: 360, label: { x: 428, y: 364, anchor: "end" }, chips: { x: 322, y: 352, align: "start" } },
  "u3-ostbahnhof": { x: 720, y: 690, label: { x: 736, y: 694, anchor: "start" }, chips: { x: 736, y: 666, align: "start" } },
  "u3-stadtbruecke": { x: 840, y: 810, label: { x: 854, y: 814, anchor: "start" } },
  "u3-museumsinsel": { x: 920, y: 890, label: { x: 934, y: 894, anchor: "start" } },
  "u3-kanalpark": { x: 1000, y: 970, label: { x: 1014, y: 974, anchor: "start" } },
  "u3-seetor": { x: 1080, y: 1050, label: { x: 1094, y: 1054, anchor: "start" }, chips: { x: 1094, y: 1060, align: "start" } },
  "u4-kaiser-humboldt": { x: 110, y: 560, label: { x: 110, y: 580, anchor: "middle" }, chips: { x: 58, y: 552, align: "start" } },
  "u4-westbahnhof": { x: 260, y: 560, label: { x: 260, y: 546, anchor: "middle" }, chips: { x: 278, y: 568, align: "start" } },
  "u4-arabellapark": { x: 1040, y: 350, label: { x: 1040, y: 374, anchor: "middle" }, chips: { x: 1040, y: 382, align: "middle" } },
  "u5-suedstadt": { x: 260, y: 650, label: { x: 248, y: 654, anchor: "end" } },
  "u5-stadionpark": { x: 260, y: 740, label: { x: 248, y: 744, anchor: "end" } },
  "u5-messepark": { x: 340, y: 930, label: { x: 330, y: 944, anchor: "end" } },
  "u5-technologiecampus": { x: 420, y: 965, label: { x: 408, y: 969, anchor: "end" } },
  "u5-flughafen": { x: 420, y: 1110, label: { x: 408, y: 1114, anchor: "end" } },
  "u5-nordklinikum": { x: 560, y: 970, label: { x: 572, y: 990, anchor: "start" }, chips: { x: 572, y: 998, align: "start" } },
  "u5-waldtor": { x: 560, y: 850, label: { x: 546, y: 840, anchor: "end" }, chips: { x: 546, y: 856, align: "end" } },
  "u5-hafenbogen": { x: 610, y: 800, label: { x: 598, y: 798, anchor: "end" } },
  "u5-altstadtbruecke": { x: 730, y: 1030, label: { x: 718, y: 1034, anchor: "end" } },
  "u5-uferpromenade": { x: 970, y: 1055, label: { x: 982, y: 1080, anchor: "start" } },
  "u5-steinbogen": { x: 930, y: 1010, label: { x: 930, y: 998, anchor: "middle" } },
  "u6-theaterinsel": { x: 230, y: 340, label: { x: 218, y: 344, anchor: "end" } },
  "u6-suedklinikum": { x: 230, y: 250, label: { x: 218, y: 254, anchor: "end" } },
  "u6-sonnenfeld": { x: 380, y: 170, label: { x: 380, y: 190, anchor: "middle" } },
  "u6-ringplatz": { x: 530, y: 170, label: { x: 518, y: 190, anchor: "end" }, chips: { x: 542, y: 180, align: "start" } },
  "u6-waldsee": { x: 690, y: 170, label: { x: 690, y: 190, anchor: "middle" } },
  "u6-feldkirchen": { x: 820, y: 170, label: { x: 820, y: 190, anchor: "middle" } },
  "u6-industriepark": { x: 950, y: 170, label: { x: 950, y: 190, anchor: "middle" } },
  "u9-kaiserforum": { x: 500, y: 575, label: { x: 512, y: 580, anchor: "start" } },
  "u9-goldmarkt": { x: 460, y: 700, label: { x: 448, y: 704, anchor: "end" } },
  "u9-sonnenviertel": { x: 460, y: 790, label: { x: 448, y: 794, anchor: "end" } },
  "u9-hohenbrueck": { x: 670, y: 970, label: { x: 660, y: 958, anchor: "end" } },
  "u9-kronenplatz": { x: 670, y: 890, label: { x: 658, y: 904, anchor: "end" } },
  "u10-finanzforum": { x: 530, y: 300, label: { x: 518, y: 304, anchor: "end" } },
  "u10-eastend": { x: 530, y: 110, label: { x: 518, y: 114, anchor: "end" } },
  "u10-skyline": { x: 690, y: 70, label: { x: 690, y: 56, anchor: "middle" }, sub: { x: 690, y: 37, anchor: "middle" } },
  "u10-metropol": { x: 820, y: 70, label: { x: 820, y: 56, anchor: "middle" }, sub: { x: 820, y: 37, anchor: "middle" } },
  "u10-botanical": { x: 960, y: 70, label: { x: 960, y: 56, anchor: "middle" }, sub: { x: 960, y: 37, anchor: "middle" } },
  "u10-europa": { x: 1120, y: 175, label: { x: 1134, y: 172, anchor: "start" }, sub: { x: 1134, y: 186, anchor: "start" } },
  "u10-airportpark": { x: 1120, y: 265, label: { x: 1134, y: 262, anchor: "start" }, sub: { x: 1134, y: 276, anchor: "start" } },
  "u10-airport": { x: 1120, y: 360, label: { x: 1134, y: 357, anchor: "start" }, sub: { x: 1134, y: 371, anchor: "start" }, chips: { x: 1134, y: 380, align: "start" } },
  "station-2": { x: 548, y: 455, label: { x: 532, y: 470, anchor: "end" }, chips: { x: 360, y: 489, align: "start" } },
});

/** The multi-level Central complex is drawn as one interchange body. */
export const COMPLEX_LAYOUT = Object.freeze({
  'station-2': {
    connector: "M 530 414 L 548 448",
    body: { x: 540, y: 442, w: 40, h: 84, r: 20 },
    core: { x: 545, y: 447, w: 30, h: 74, r: 15 },
    /** Separate platform symbols for lines whose track ends outside the body. */
    platforms: { U10: { x: 530, y: 414 }},
  },
});

/** Decorative, line-bound drawing details. Text for sections is derived from game data. */
export const DECOR_LAYOUT = Object.freeze({
  viaduct: { line: "U10", d: "M 702 64.9 L 702 61.4 M 702 75.1 L 702 78.6 M 713 64.9 L 713 61.4 M 713 75.1 L 713 78.6 M 724 64.9 L 724 61.4 M 724 75.1 L 724 78.6 M 735 64.9 L 735 61.4 M 735 75.1 L 735 78.6 M 746 64.9 L 746 61.4 M 746 75.1 L 746 78.6 M 757 64.9 L 757 61.4 M 757 75.1 L 757 78.6 M 768 64.9 L 768 61.4 M 768 75.1 L 768 78.6 M 779 64.9 L 779 61.4 M 779 75.1 L 779 78.6 M 790 64.9 L 790 61.4 M 790 75.1 L 790 78.6 M 801 64.9 L 801 61.4 M 801 75.1 L 801 78.6 M 832 64.9 L 832 61.4 M 832 75.1 L 832 78.6 M 843 64.9 L 843 61.4 M 843 75.1 L 843 78.6 M 854 64.9 L 854 61.4 M 854 75.1 L 854 78.6 M 865 64.9 L 865 61.4 M 865 75.1 L 865 78.6 M 876 64.9 L 876 61.4 M 876 75.1 L 876 78.6 M 887 64.9 L 887 61.4 M 887 75.1 L 887 78.6 M 898 64.9 L 898 61.4 M 898 75.1 L 898 78.6 M 909 64.9 L 909 61.4 M 909 75.1 L 909 78.6 M 920 64.9 L 920 61.4 M 920 75.1 L 920 78.6 M 931 64.9 L 931 61.4 M 931 75.1 L 931 78.6 M 942 64.9 L 942 61.4 M 942 75.1 L 942 78.6 M 972 64.9 L 972 61.4 M 972 75.1 L 972 78.6 M 983 64.9 L 983 61.4 M 983 75.1 L 983 78.6 M 994 64.9 L 994 61.4 M 994 75.1 L 994 78.6 M 1005 64.9 L 1005 61.4 M 1005 75.1 L 1005 78.6 M 1016 64.9 L 1016 61.4 M 1016 75.1 L 1016 78.6 M 1027 64.9 L 1027 61.4 M 1027 75.1 L 1027 78.6 M 1038 64.9 L 1038 61.4 M 1038 75.1 L 1038 78.6 M 1049 64.9 L 1049 61.4 M 1049 75.1 L 1049 78.6 M 1060 64.9 L 1060 61.4 M 1060 75.1 L 1060 78.6 M 1071 64.9 L 1071 61.4 M 1071 75.1 L 1071 78.6 M 1082 64.9 L 1082 61.4 M 1082 75.1 L 1082 78.6 M 1093 64.9 L 1093 61.4 M 1093 75.1 L 1093 78.6 M 1104 64.9 L 1104 61.4 M 1104 75.1 L 1104 78.6 M 1125.1 82 L 1128.6 82 M 1114.9 82 L 1111.4 82 M 1125.1 93 L 1128.6 93 M 1114.9 93 L 1111.4 93 M 1125.1 104 L 1128.6 104 M 1114.9 104 L 1111.4 104 M 1125.1 115 L 1128.6 115 M 1114.9 115 L 1111.4 115 M 1125.1 126 L 1128.6 126 M 1114.9 126 L 1111.4 126 M 1125.1 137 L 1128.6 137 M 1114.9 137 L 1111.4 137 M 1125.1 148 L 1128.6 148 M 1114.9 148 L 1111.4 148 M 1125.1 159 L 1128.6 159 M 1114.9 159 L 1111.4 159 M 1125.1 187 L 1128.6 187 M 1114.9 187 L 1111.4 187 M 1125.1 198 L 1128.6 198 M 1114.9 198 L 1111.4 198 M 1125.1 209 L 1128.6 209 M 1114.9 209 L 1111.4 209 M 1125.1 220 L 1128.6 220 M 1114.9 220 L 1111.4 220 M 1125.1 231 L 1128.6 231 M 1114.9 231 L 1111.4 231 M 1125.1 242 L 1128.6 242 M 1114.9 242 L 1111.4 242 M 1125.1 253 L 1128.6 253 M 1114.9 253 L 1111.4 253 M 1125.1 277 L 1128.6 277 M 1114.9 277 L 1111.4 277 M 1125.1 288 L 1128.6 288 M 1114.9 288 L 1111.4 288 M 1125.1 299 L 1128.6 299 M 1114.9 299 L 1111.4 299 M 1125.1 310 L 1128.6 310 M 1114.9 310 L 1111.4 310 M 1125.1 321 L 1128.6 321 M 1114.9 321 L 1111.4 321 M 1125.1 332 L 1128.6 332 M 1114.9 332 L 1111.4 332 M 1125.1 343 L 1128.6 343 M 1114.9 343 L 1111.4 343 M 622 64.9 L 622 61.4 M 622 75.1 L 622 78.6 M 633 64.9 L 633 61.4 M 633 75.1 L 633 78.6 M 644 64.9 L 644 61.4 M 644 75.1 L 644 78.6 M 655 64.9 L 655 61.4 M 655 75.1 L 655 78.6 M 666 64.9 L 666 61.4 M 666 75.1 L 666 78.6 M 677 64.9 L 677 61.4 M 677 75.1 L 677 78.6" },
  portal: { line: "U10", d: "M 613 59 A 11 11 0 0 0 613 81" },
  sections: [
    { kind: "variant", line: "U5", x: 790, y: 1124, anchor: "middle" },
    { kind: "underground", line: "U10", x: 518, y: 238, anchor: "end" },
    { kind: "elevated", line: "U10", x: 820, y: 104, anchor: "middle" },
    { kind: "portal", line: "U10", x: 610, y: 96, anchor: "middle" },
  ],
});

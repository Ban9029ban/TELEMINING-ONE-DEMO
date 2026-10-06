// TELEMINING ZENIT URTS-B enclosure simple (PLA 0.4mm tuned)
// Caja 170 x 100 x 60 mm + tapa con logo y ranuras
// Unidades: mm

//-----------------------------------------------------
// PARAMETROS PRINCIPALES
//-----------------------------------------------------
case_len   = 170;   // largo exterior caja
case_wid   = 100;   // ancho exterior caja
case_h     = 60;    // alto exterior caja

// Tapa
lid_base_thick = 8;   // grosor sólido de la tapa
fin_height     = 2;   // altura extra de aletas
logo_height    = 1.2; // relieve del logo

// Paredes y cavidad (ajustado a múltiples de 0.4 mm)
wall          = 2.4;    // grosor pared (6 líneas de 0.4)
bottom_thick  = 3;      // grosor piso
lip_height    = 3;      // altura de la barba en la caja
lip_width     = 1.2;    // ancho del aro de la barba (3 líneas de 0.4)
lip_clearance = 0.25;   // holgura con la tapa (PLA)

inner_len = case_len - 2*wall;
inner_wid = case_wid - 2*wall;

// PCB (para pilares)
pcb_len     = 150;
pcb_wid     = 70;
pcb_thick   = 1.6;
hole_edge_x = 5;
hole_edge_y = 5;

board_off_x = wall + (inner_len - pcb_len)/2;
board_off_y = wall + (inner_wid - pcb_wid)/2;

hole_pos = [
    [board_off_x + hole_edge_x,                 board_off_y + hole_edge_y],
    [board_off_x + pcb_len - hole_edge_x,       board_off_y + hole_edge_y],
    [board_off_x + hole_edge_x,                 board_off_y + pcb_wid - hole_edge_y],
    [board_off_x + pcb_len - hole_edge_x,       board_off_y + pcb_wid - hole_edge_y]
];

// Pilares y tornillos
standoff_d = 6;        // diámetro del pilar
standoff_h = pcb_thick + 6;
screw_d    = 3.2;      // agujero para tornillo M3 (sobredimensionado)

// Aletas disipadoras en la tapa
fin_width  = 3;
fin_gap    = 3;
fin_margin = 6;

// Zona sin aletas para logo
logo_zone_center = case_len/2;
logo_zone_half   = 40;
logo_size        = 12;

// Solapas (orejas) de montaje
tab_len    = 18;   // longitud desde la pared hacia afuera
tab_width  = 20;   // ancho (vertical en la vista de arriba)
tab_hole_r = 3.7;  // radio del agujero para tornillo (~7.4mm Ø)
tab_height = 10;   // altura (1 cm)

// Agujeros para antenas
ant_d       = 7.2;    // diámetro del agujero SMA (ligeramente mayor)
ant_spacing = 40;     // separación entre antenas
ant_height  = 30;     // altura desde el piso
ant_on_back = false;  // false = lado frontal (y=0); true = lado trasero (y=case_wid)


//-----------------------------------------------------
// MODULOS AUXILIARES
//-----------------------------------------------------

// Pilares para fijar la PCB
module standoffs() {
    for (p = hole_pos) {
        translate([p[0], p[1], bottom_thick])
            difference() {
                cylinder(h = standoff_h, d = standoff_d, $fn = 40);
                cylinder(h = standoff_h + 0.2, d = screw_d, $fn = 30);
            }
    }
}

// Agujeros para antenas (se restan a la caja)
module antenna_holes() {
    ant_y = ant_on_back ? case_wid : 0;
    x_center = case_len/2;
    x1 = x_center - ant_spacing/2;
    x2 = x_center + ant_spacing/2;

    for (x_ = [x1, x2]) {
        translate([x_, ant_y, ant_height])
            rotate([-90,0,0])
                cylinder(h = wall + 10, d = ant_d, $fn = 40);
    }
}

// Oreja básica que sale hacia +X (recta + curva)
module ear3d() {
    difference() {
        union() {
            // parte recta
            cube([tab_len, tab_width, tab_height], center = false);
            // parte curva
            translate([tab_len, tab_width/2, 0])
                cylinder(h = tab_height, r = tab_width/2, $fn = 40);
        }
        // agujero de tornillo
        translate([tab_len, tab_width/2, 0])
            cylinder(h = tab_height + 0.2, r = tab_hole_r, $fn = 30);
    }
}

// Dos solapas pegadas al centro de los lados largos de la caja
module mounting_tabs_3d() {
    // Lado izquierdo: oreja hacia -X
    mirror([1,0,0])  // invierte hacia -X
        translate([0, case_wid/2 - tab_width/2, 0])
            ear3d();

    // Lado derecho: oreja hacia +X
    translate([case_len, case_wid/2 - tab_width/2, 0])
        ear3d();
}

// Aletas disipadoras sobre la tapa
module heat_fins() {
    for (x_ = [fin_margin : (fin_width + fin_gap) : case_len - fin_margin]) {
        if ((x_ < logo_zone_center - logo_zone_half) ||
            (x_ > logo_zone_center + logo_zone_half)) {
            translate([x_, fin_margin, lid_base_thick])
                cube([fin_width,
                      case_wid - 2*fin_margin,
                      fin_height], center=false);
        }
    }
}

// Logo TELEMINING ONE (icono circular + texto)
module telemining_logo() {
    logo_x = logo_zone_center;
    logo_y = case_wid/2;
    z0     = lid_base_thick + fin_height;

    // ---------- ICONO CIRCULAR ----------
    icon_d = 26;
    icon_r = icon_d/2;
    icon_x = logo_x - 40;    // desplazamiento hacia la izquierda
    icon_y = logo_y + 4;     // un pelín hacia arriba

    // círculo con “bandas” tipo ondas
    translate([icon_x, icon_y, z0])
        linear_extrude(height = logo_height)
            union() {
                // anillo exterior
                difference() {
                    circle(r = icon_r, $fn = 64);
                    circle(r = icon_r - 2, $fn = 64);
                }

                // tres bandas horizontales recortadas por el círculo
                intersection() {
                    circle(r = icon_r - 2, $fn = 64);
                    union() {
                        translate([-icon_r, -4])
                            square([icon_d, 3], center = false);
                        translate([-icon_r, -1])
                            square([icon_d, 3], center = false);
                        translate([-icon_r, 2])
                            square([icon_d, 3], center = false);
                    }
                }
            };

    // ---------- TEXTO "TELEMINING" ----------
    txt1_size = 10;
    txt2_size = 8;

    // posición del texto principal, a la derecha del icono
    txt1_x = icon_x + icon_r + 6;
    txt1_y = icon_y + 3;

    translate([txt1_x, txt1_y, z0])
        linear_extrude(height = logo_height)
            text("TELEMINING",
                 size   = txt1_size,
                 halign = "left",
                 valign = "center",
                 font   = "Liberation Sans:Bold");

    // ---------- TEXTO "ONE" bajo TELEMINING ----------
    txt2_x = txt1_x;
    txt2_y = icon_y - 7;

    translate([txt2_x, txt2_y, z0])
        linear_extrude(height = logo_height)
            text("ONE",
                 size   = txt2_size,
                 halign = "left",
                 valign = "center",
                 font   = "Liberation Sans:Bold");
}


//-----------------------------------------------------
// BASE (CAJA)
//  - Piso + 4 paredes hechas con cubos
//  - Barba interior en la parte superior
//  - Solapas de montaje de 10 mm
//-----------------------------------------------------
module base() {
    difference() {
        union() {
            // 1) PISO
            cube([case_len, case_wid, bottom_thick], center = false);

            // 2) PAREDES (4 lados)
            // Frente
            translate([0, 0, bottom_thick])
                cube([case_len, wall, case_h - bottom_thick], center = false);
            // Fondo
            translate([0, case_wid - wall, bottom_thick])
                cube([case_len, wall, case_h - bottom_thick], center = false);
            // Izquierda
            translate([0, 0, bottom_thick])
                cube([wall, case_wid, case_h - bottom_thick], center = false);
            // Derecha
            translate([case_len - wall, 0, bottom_thick])
                cube([wall, case_wid, case_h - bottom_thick], center = false);

            // 3) BARBA INTERIOR (un aro de 3 mm de alto)
            z_lip = case_h - lip_height;
            // Frente
            translate([wall, wall, z_lip])
                cube([inner_len, lip_width, lip_height], center = false);
            // Fondo
            translate([wall, case_wid - wall - lip_width, z_lip])
                cube([inner_len, lip_width, lip_height], center = false);
            // Izquierda
            translate([wall, wall, z_lip])
                cube([lip_width, inner_wid, lip_height], center = false);
            // Derecha
            translate([case_len - wall - lip_width, wall, z_lip])
                cube([lip_width, inner_wid, lip_height], center = false);

            // 4) SOLAPAS DE MONTAJE
            mounting_tabs_3d();

            // 5) PILARES PARA PCB
            standoffs();
        }

        // 6) AGUJEROS DE ANTENAS
        antenna_holes();
    }
}


//-----------------------------------------------------
// TAPA
//  - Placa sólida de 8 mm
//  - Rebaje interior para entrar sobre la barba
//  - Aletas + logo
//-----------------------------------------------------
module lid() {
    difference() {
        // Placa completa
        cube([case_len, case_wid, lid_base_thick], center = false);

        // Rebaje donde entra la barba de la caja
        translate([wall - lip_clearance,
                   wall - lip_clearance,
                   0])
            cube([inner_len + 2*lip_clearance,
                  inner_wid + 2*lip_clearance,
                  lip_height + 0.6], center = false);
    }

    // Aletas y logo encima
    heat_fins();
    telemining_logo();
}


//-----------------------------------------------------
// ENSAMBLAJE PARA VER
//-----------------------------------------------------

view_gap = 40;  // separación visual entre caja y tapa

// Caja en el origen
base();

// Tapa al lado derecho
translate([case_len + view_gap, 0, 0])
    lid();

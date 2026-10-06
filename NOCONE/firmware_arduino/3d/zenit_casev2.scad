//
// Enclosure ZENIT URTS-B + tapa con logo TELEMINING
// Caja: 170 x 100 x 60 mm
// Tapa: 170 x 100 x 10 mm
// Unidades: mm
//

// ==================== DIMENSIONES GLOBALES ====================
case_len   = 170;  // largo exterior caja
case_wid   = 100;  // ancho exterior caja
case_h     = 60;   // alto exterior caja (sin tapa)

lid_thick  = 10;   // grosor de la tapa (1 cm)

// ==================== PARÁMETROS DE PAREDES Y ESPACIOS ====================
wall          = 3;      // grosor de pared
bottom_thick  = 3;      // piso de la caja
inner_h       = case_h - bottom_thick - 2; // espacio útil interno

// cavidad interior
inner_len = case_len - 2*wall;
inner_wid = case_wid - 2*wall;

// ==================== PCB (AJUSTABLE A TU PLACA) ====================
// Ajusta estas medidas según la PCB real de ZENIT si quieres usar los pilares:
pcb_len     = 150;   // largo aproximado de la placa
pcb_wid     = 70;    // ancho aproximado de la placa
pcb_thick   = 1.6;

hole_edge_x = 5;     // distancia del hoyo al borde corto de la PCB
hole_edge_y = 5;     // distancia del hoyo al borde largo

// La placa se centra dentro de la caja
board_off_x = wall + (inner_len - pcb_len)/2;
board_off_y = wall + (inner_wid - pcb_wid)/2;

// Posiciones de los 4 hoyos de la placa
hole_pos = [
    [board_off_x + hole_edge_x,                 board_off_y + hole_edge_y],
    [board_off_x + pcb_len - hole_edge_x,       board_off_y + hole_edge_y],
    [board_off_x + hole_edge_x,                 board_off_y + pcb_wid - hole_edge_y],
    [board_off_x + pcb_len - hole_edge_x,       board_off_y + pcb_wid - hole_edge_y]
];

// ==================== PILARES Y TORNILLOS ====================
standoff_d  = 6;    // diámetro del pilar
standoff_h  = pcb_thick + 6; // altura de pilar
screw_d     = 3;    // agujero para tornillo M3

// ==================== LIP DE LA TAPA ====================
lip_height  = 3;    // cuánto entra la tapa dentro de la caja
lip_offset  = 0.8;  // separación respecto de las paredes internas

// ==================== LOGO ====================
logo_height = 2;      // altura de relieve del logo
logo_size   = 12;     // tamaño de letra TELEMINING


// ================================================================
// MÓDULOS
// ================================================================

module standoffs() {
    // pilares internos con agujero M3
    for (p = hole_pos) {
        translate([p[0], p[1], bottom_thick])
            difference() {
                cylinder(h = standoff_h, d = standoff_d, $fn = 40);
                cylinder(h = standoff_h + 0.2, d = screw_d, $fn = 30);
            }
    }
}

module base() {
    // Caja exterior
    difference() {
        // bloque exterior
        cube([case_len, case_wid, case_h], center = false);

        // hueco interior
        translate([wall, wall, bottom_thick])
            cube([inner_len, inner_wid, inner_h], center = false);

        // agujeros para tornillos que bajan desde la tapa
        for (p = hole_pos) {
            translate([p[0], p[1], case_h - lip_height])
                cylinder(h = lip_height + 1, d = screw_d + 0.3, $fn = 30);
        }
    }

    // Pilares de soporte PCB
    standoffs();
}

module lid() {
    // Placa de tapa de 10 mm de grosor
    difference() {
        translate([0,0,case_h])
            cube([case_len, case_wid, lid_thick], center = false);

        // Agujeros para tornillos M3 alineados con los pilares
        for (p = hole_pos) {
            translate([p[0], p[1], case_h - 0.1])
                cylinder(h = lid_thick + 0.5, d = screw_d + 0.3, $fn = 30);
        }
    }

    // Lip que entra dentro de la caja para centrar la tapa
    translate([wall + lip_offset,
               wall + lip_offset,
               case_h - lip_height])
        cube([inner_len - 2*lip_offset,
              inner_wid - 2*lip_offset,
              lip_height], center=false);

    // Logo 3D TELEMINING sobre la tapa
    telemining_logo();
}

module telemining_logo() {
    // Centro del logo más o menos en la mitad de la tapa
    logo_x = case_len * 0.5;
    logo_y = case_wid * 0.55;

    // Texto principal
    translate([logo_x, logo_y, case_h + lid_thick])
        linear_extrude(height = logo_height)
            text("TELEMINING",
                 size   = logo_size,
                 halign = "center",
                 valign = "center",
                 font   = "Liberation Sans:Bold");

    // Un pequeño “halo” de rayos alrededor del logo
    ray_radius = logo_size * 0.9;
    ray_len    = logo_size * 0.5;
    ray_width  = logo_size * 0.12;

    for (a = [0:45:315]) {
        translate([logo_x, logo_y, case_h + lid_thick])
            rotate([0,0,a])
                translate([ray_radius,0,0])
                    linear_extrude(height = logo_height)
                        square([ray_len, ray_width], center=true);
    }
}

// ================================================================
// ENSAMBLAJE
// ================================================================

// Para ver todo junto (caja + tapa):
base();
lid();

// ---------- PARA EXPORTAR STL ----------
// 1) Comenta las dos líneas de arriba.
// 2) Deja solo una de estas, según lo que quieras exportar:
//
// base();   // Exportar base
// lid();    // Exportar tapa
//
// Luego: Design -> Render (F6) -> File -> Export -> Export as STL.

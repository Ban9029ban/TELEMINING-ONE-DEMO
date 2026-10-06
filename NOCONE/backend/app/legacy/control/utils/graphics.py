from .vehicles import get_vehicle_status
from .people import count_persons_per_level
from .vehicles import contador_vehiculos_view
from .zenit import get_zenit_status

def get_graphic_data(UsePX=False, minDate='', maxDate=''):
    data = {
        'vehicleStatus': get_vehicle_status(),
        'peoplePerLevel': count_persons_per_level(UsePX, minDate, maxDate),
        'vehiclesPerLevel': contador_vehiculos_view(),
        'zenitSystemStatus': get_zenit_status(),
    }
    return data
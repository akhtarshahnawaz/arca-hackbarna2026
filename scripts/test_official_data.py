import unittest
from unittest.mock import patch
from import_official_data import coordinates, enrolments, match_hospital, geocode

class ImportTests(unittest.TestCase):
    def test_rejects_corrupt_school_geojson_and_swapped_axes(self):
        self.assertIsNone(coordinates(1929887, 414736))
        self.assertIsNone(coordinates(41.4, 1.9))
        self.assertEqual(coordinates('1.9', '41.4'), (1.9, 41.4))

    def test_enrolments_preserve_year_and_unknown_counts(self):
        rows = [dict(codi_centre='08001', curs='2025/2026', matr_cules_total='44', matr_cules_dones='25'),
                dict(codi_centre='08001', curs='2025/2026', matr_cules_total='30'),
                dict(codi_centre='08001', curs='2024/2025', matr_cules_total='90'),
                dict(codi_centre='08002', curs='2025/2026', matr_cules_total='..')]
        result = enrolments(rows)
        self.assertEqual(result[('08001', '2025/2026')], 74)
        self.assertIsNone(result[('08002', '2025/2026')])

    def test_hospital_name_variants_and_ambiguous_matches(self):
        site = dict(name='Hospital Sant Joan de Déu de Manresa', municipality='MANRESA')
        hospital = {'Nombre Centro': 'Hospital de Sant Joan de Deu (Manresa)', 'Municipio': 'Manresa', 'CCN': '0908005217'}
        self.assertEqual(match_hospital(site, [hospital]), hospital)
        self.assertIsNone(match_hospital(site, [hospital, hospital]))
        self.assertIsNone(match_hospital(dict(site, municipality='Barcelona'), [hospital]))

    @patch('import_official_data.download', return_value=b'[{"type":"portal","muni":"Manresa","postalCode":"08241","portalNumber":11}]')
    def test_geocoder_rejects_neighbouring_house_number(self, download):
        self.assertIsNone(geocode('Carrer Saleses 10', '08241', 'Manresa', {}))

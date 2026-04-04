import csv
import json

universities = []
with open('universcity_2025.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        universities.append({
            'name': row['학교명'],
            'address': row['도로명주소'],
            'lat': float(row['위도']),
            'lng': float(row['경도']),
            'homepage': row['학교홈페이지'],
            'phone': row['학교대표\n번호']
        })

with open('universities.json', 'w', encoding='utf-8') as f:
    json.dump(universities, f, ensure_ascii=False, indent=4)
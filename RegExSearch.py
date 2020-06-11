import re
import csv
import math
import requests
import os


def cvsReader():
    with open('Vinskap\produkter.csv', newline='', encoding="utf8") as csvfile:
        csvFile = csv.DictReader(csvfile, delimiter=';')
        for row in csvFile:
            y = re.findall(navn + ".*", str(row))
            if len(y) > 0:
                navneliste.append(row)


navneliste = list()
navn = "Zacapa"
cvsReader()

for vare in navneliste:
    print(vare)

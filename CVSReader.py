import csv
import math
import requests
import os


def cvsReader():
    total = 0
    antall = 0
    typename = "Literpris"
    with open('Vinskap\produkter.csv', newline='', encoding="utf8") as csvfile:
        csvFile = csv.DictReader(csvfile, delimiter=';')
        print()
        for row in csvFile:
            if type == "Literpris":
                print(float(row['Pris'].replace(',', '.')))
            else:
                print(row[typename])
            total += float(row['Pris'].replace(',', '.'))
            antall += 1

    print("The average price is", math.floor(total / antall), "kr")
    os.rename(r'Vinskap\new_produkter.csv', r'Vinskap\old_produkter.csv')


def updateCVSFile():
    print('Beginning file download with urllib2...')
    fileUpdated = False

    try:

        url = 'https://www.vinmonopolet.no/medias/sys_master/products/products/hbc/hb0/8834253127710/produkter.csvlk'
        r = requests.get(url, allow_redirects=True)
        print(r)
        if r.status_code == 200:
            open('Vinskap/new_produkter.csv', 'wb').write(r.content)
            fileUpdated = True
        else:
            print("File not updated")

    except requests.exceptions.Timeout:
        # Maybe set up for a retry, or continue in a retry loop
        print("Timeout exceeded, file not updated")
    except requests.exceptions.TooManyRedirects:
        # Tell the user their URL was bad and try a different one
        print("Too many redirects, file not updated")

    except requests.exceptions.RequestException as e:
        # catastrophic error. bail.
        print("Catastrophic error, file not updated")

    if not fileUpdated:
        os.rename(r'Vinskap\old_produkter.csv', r'Vinskap\new_produkter.csv')


updateCVSFile()


import sqlite3
import re


def DBReader():
    conn = sqlite3.connect("Vinskap/BarMaidenDatabase.db")
    cur = conn.cursor()
    sqlstr = 'SELECT Pris FROM produkter'
    test = cur.execute(sqlstr)
    total, i, lowest, highest = (0, 0, 1000, 0)

    for row in test:
        price = float(row[0].replace(',', '.'))
        total += price
        i += 1
        if price > highest: highest = price
        elif price < lowest: lowest = price

    print("Høyeste pris er", highest, "kr")
    print("Laveste pris er", lowest, "kr")
    print("Totalen ligger på", int(total), "kr")
    print("Gjennomsnitlig pris er:", int(total/i))


DBReader()

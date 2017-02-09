import csv
pList = []
j, i = 0, 0

with open('produkter.csv', newline='') as csvfile:
    reader = csv.reader(csvfile, delimiter=';')
    for row in reader:
        pList.append([])
        for value in row:
            pList[j].append(value)
            i += 1
        i = 0
        j += 1
k, l = 0, 0
matching = []
for prod in pList:
    matching.append([s for s in pList[k] if 'Finlandia' in s])
    if matching[k] == '':
        matching[k].clear()
    k += 1
print(matching)


import sys
import csv
import math
import requests
import os
import re

from PyQt5.QtWidgets import *
from PyQt5.QtCore import *
from PyQt5.QtGui import *

# <a target="_blank" href="https://icons8.com/icons/set/menu">Menu icon</a> icon by <a target="_blank" href="https://icons8.com">Icons8</a>


class WorkerSignals(QObject):

    # Defines the signals available from a running worker thread.
    finished = pyqtSignal()
    error = pyqtSignal(str)
    result = pyqtSignal(float, float)


class Worker(QRunnable):
    def __init__(self, fn, *args, **kwargs):
        super(Worker, self).__init__()
        # Store constructor arguments (re-used for processing)
        self.fn = fn
        self.args = args
        self.kwargs = kwargs

    @pyqtSlot()
    def run(self):
        '''
        Initialise the runner function with passed args, kwargs.
        '''
        self.fn(*self.args, **self.kwargs)


class MainWindow(QMainWindow):
    counter = 0
    message = "Start"
    csvFile = dict()
    type = "Varenavn"
    navneliste = list()

    def __init__(self, *args, **kwargs):
        super(MainWindow, self).__init__(*args, **kwargs)

        layout = QVBoxLayout()

        self.l = QLabel(self.message)
        b = QPushButton("Oppdater CSV")
        b.pressed.connect(self.updtCSV)

        c = QPushButton("Les CSV")
        c.pressed.connect(self.oh_no)

        d = QPushButton("Søk")
        d.pressed.connect(self.searchAction)

        layout.addWidget(self.l)
        layout.addWidget(b)
        layout.addWidget(c)
        layout.addWidget(d)

        self.textBox = QLineEdit()
        layout.addWidget(self.textBox)
        w = QWidget()
        w.setLayout(layout)
        self.setCentralWidget(w)
        self.show()
        self.threadpool = QThreadPool()

    def change_message(self):
        self.type = "Literpris" if self.type == "Varenavn" else "Varenavn"

    def csvReader(self):
        total = 0
        antall = 0

        self.csvFile = csv.DictReader(open('Vinskap\produkter.csv', newline='', encoding="utf8", mode='r'), delimiter=';')
        print()
        for row in self.csvFile:
            if self.type == "Literpris":
                print(float(row['Pris'].replace(',', '.')), "kr")
                total += float(row['Pris'].replace(',', '.'))
                antall += 1
            else:
                print(row[self.type])
        if self.type == "Literpris":
            print("The average price is", math.floor(total/antall), "kr")

    def search(self):
        navn = self.textBox.text()
        print("Dette søker du på:", navn)
        for row in self.csvFile:
            print("Size of row", len(row))
            y = re.findall(navn + ".*", str(row))
            print("Size of y", len(y))
            if len(y) > 0:
                print("Append")
                self.navneliste.append(row)
                print(row)


    def updateCVSFile(self):
        print('Updating the csv file')
        os.rename(r'Vinskap\new_produkter.csv', r'Vinskap\old_produkter.csv')
        fileUpdated = False

        try:
            url = 'https://www.vinmonopolet.no/medias/sys_master/products/products/hbc/hb0/8834253127710/produkter.csv'
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
            print("Bad URL, file not updated")

        except requests.exceptions.RequestException as e:
            # catastrophic error. bail.
            print("Catastrophic error, file not updated")

        if not fileUpdated:
            os.rename(r'Vinskap\old_produkter.csv', r'Vinskap\new_produkter.csv')

    def updtCSV(self):
        worker = Worker(self.updateCVSFile)
        self.threadpool.start(worker)

    def oh_no(self):
        worker = Worker(self.csvReader)
        self.threadpool.start(worker)

    def searchAction(self):
        worker = Worker(self.search())
        self.threadpool.start(worker)


app = QApplication([])
window = MainWindow()
app.exec_()

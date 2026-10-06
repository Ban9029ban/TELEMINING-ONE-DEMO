@echo off
python -m pip install -r requirements.txt
python simulator.py --mode tcp --rate 15

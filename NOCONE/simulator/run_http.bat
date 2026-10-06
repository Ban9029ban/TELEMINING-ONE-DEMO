@echo off
python -m pip install -r requirements.txt
python simulator.py --mode http --rate 15

const context = document.querySelector('.app-chart').getContext('2d')
context.fillStyle = '#0969da'
for (const [i, height] of [40, 70, 55, 90, 65].entries()) context.fillRect(i * 40, 100 - height, 28, height)

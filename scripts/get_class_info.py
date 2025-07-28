import asyncio
import json
import os
import tempfile
import shutil
import psutil
import time
import sys
from bs4 import BeautifulSoup
from typing import Dict, List, Optional
from playwright.async_api import async_playwright

def get_memory_usage():
    """Returns memory usage of the current process in MB."""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        return {
            "rss": round(mem_info.rss / (1024 * 1024), 2),  # Resident Set Size
            "vms": round(mem_info.vms / (1024 * 1024), 2)   # Virtual Memory Size
        }
    except Exception as e:
        print(f"[{time.time()}] [MEMORY_ERROR] {e}", file=sys.stderr)
        return {"rss": 0, "vms": 0}

async def getClassInfo(classNumber: str) -> Dict:
    """
    Scrapes detailed class information from ASU catalog using Playwright.
    
    Args:
      classNumber (str): The 5-digit class number to search for.
      
    Returns:
      Dict: A dictionary containing extracted class info, or None if not found.
    """
    print(f"[{time.time()}] [START] Processing class {classNumber} with Playwright", file=sys.stderr)
    print(f"[{time.time()}] [MEMORY_TRACK] Before Playwright init: {get_memory_usage()}", file=sys.stderr)

    browser_context = None
    user_data_dir = None
    
    try:
        # Create a unique temporary directory for this session's user data
        user_data_dir = tempfile.mkdtemp(prefix='chrome_user_data_playwright_')

        async with async_playwright() as p:
            # Launch persistent context to handle user_data_dir correctly
            # This fixes the 'Pass user_data_dir parameter' error.
            browser_context = await p.chromium.launch_persistent_context(
                user_data_dir,
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--disable-extensions',
                    '--disable-plugins-discovery', # More robust than --disable-plugins
                    '--disable-features=TranslateUI',
                    '--memory-pressure-off', # From previous optimized options
                    '--aggressive-cache-discard'
                ]
            )
            print(f"[{time.time()}] [CHROME_SETUP] User data dir: {user_data_dir}", file=sys.stderr)
            print(f"[{time.time()}] [DRIVER_SUCCESS] Playwright browser context created", file=sys.stderr)
            print(f"[{time.time()}] [MEMORY_TRACK] After Playwright init: {get_memory_usage()}", file=sys.stderr)

            page = await browser_context.new_page()
            
            # Set timeouts
            page.set_default_timeout(30000) # Default navigation timeout for page.goto, wait_for_selector
            
            url = f"https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&honors=F&keywords={classNumber}&promod=F&searchType=all&term=2257"
            
            print(f"[{time.time()}] [URL_FETCH] Fetching: {url}", file=sys.stderr)
            await page.goto(url)
            
            # Wait for the page to load properly, expecting class results
            try:
                await page.wait_for_selector(".class-results-cell", timeout=15000) # Wait for 15 seconds
                print(f"[{time.time()}] [PAGE_LOADED] Page loaded successfully", file=sys.stderr)
            except Exception as wait_error:
                print(f"[{time.time()}] [PAGE_TIMEOUT] Explicit wait timeout: {wait_error}", file=sys.stderr)
                # Continue anyway, sometimes the page loads but the wait times out for specific element
                await asyncio.sleep(2) # Give it a bit more time

            print(f"[{time.time()}] [MEMORY_TRACK] After page.goto and wait: {get_memory_usage()}", file=sys.stderr)

            html_content = await page.content()
            soup = BeautifulSoup(html_content, 'html.parser')

            # Debug: Check if we have class results
            class_results = soup.find_all("div", class_="class-results-cell")
            print(f"[{time.time()}] [DEBUG] Found {len(class_results)} class result cells", file=sys.stderr)

            # --- Start detailed data extraction logic ---
            if not class_results:
                print(f"[{time.time()}] [CLASS_NOT_FOUND] No class information found", file=sys.stderr)
                return None # No class cells found at all

            # Extract Course and Title (assuming these are unique or refer to the primary class shown)
            boldElements = soup.select('.pointer .bold-hyperlink')
            course = boldElements[0].get_text(strip=True) if len(boldElements) > 0 else "N/A"
            title = boldElements[1].get_text(strip=True) if len(boldElements) > 1 else "N/A"

            print(f"[{time.time()}] [DEBUG] Course: {course}, Title: {title}", file=sys.stderr)

            if course == "N/A" and title == "N/A":
                print(f"[{time.time()}] [CLASS_NOT_FOUND] Basic class info (course/title) not found", file=sys.stderr)
                return None

            # Instructors
            instructorDivs = soup.find_all("div", class_="class-results-cell instructor")
            instructors = []
            for div in instructorDivs:
                aTag = div.find("a", class_="link-color")
                if aTag:
                    instructor_name = aTag.get_text(strip=True)
                    if instructor_name:
                        instructors.append(instructor_name)
                else:
                    instructor_name = div.get_text(strip=True)
                    if instructor_name:
                        instructors.append(instructor_name)

            # Days
            daysElement = soup.select_one('.class-results-cell.pull-left.days p')
            days = daysElement.get_text(strip=True) if daysElement else "N/A"

            # Start Time
            startTimeElement = soup.select_one('.class-results-cell.pull-left.start p')
            start_time = startTimeElement.get_text(strip=True) if startTimeElement else "N/A"

            # End Time
            endTimeElement = soup.select_one('.class-results-cell.end p')
            end_time = endTimeElement.get_text(strip=True) if endTimeElement else "N/A"

            # Combine start and end times
            combined_time = f"{start_time} - {end_time}" if start_time != "N/A" and end_time != "N/A" else "N/A"

            # Location
            locationElement = soup.select_one('.class-results-cell.location p')
            location = locationElement.get_text(strip=True) if locationElement else "N/A"

            # Dates
            datesElement = soup.select_one('.class-results-cell.d-none.d-lg-block.dates p')
            dates = datesElement.get_text(strip=True) if datesElement else "N/A"

            # Units
            unitsElement = soup.select_one('.class-results-cell.d-none.d-lg-block.units')
            units = unitsElement.get_text(strip=True) if unitsElement else "N/A"

            # Open/closed seats
            seatElements = soup.select('.seats .text-nowrap')
            seatCounts = [seat.get_text(strip=True) for seat in seatElements] # Ensure stripping whitespace
            seat_status = "Closed"
            
            print(f"[{time.time()}] [DEBUG] Raw Seat counts: {seatCounts}", file=sys.stderr)
            
            for seat_text in seatCounts:
                if seat_text and seat_text[0].isdigit(): # Check if it starts with a digit
                    try:
                        # Extract the first number which is usually 'open seats'
                        open_seats = int(seat_text.split(' ')[0])
                        if open_seats > 0:
                            seat_status = "Open"
                            break
                    except (ValueError, IndexError):
                        continue # If parsing fails, move to next seat count
            
            if not seatCounts:
                print(f"[{time.time()}] [WARNING] No seat information found", file=sys.stderr)

            result = {
                "course": course,
                "title": title,
                "number": classNumber,
                "instructors": instructors,
                "days": days,
                "time": combined_time,
                "location": location,
                "dates": dates,
                "units": units,
                "seatStatus": seat_status,
                "startTime": start_time,
                "endTime": end_time,
            }
            
            print(f"[{time.time()}] [SUCCESS] Class data extracted successfully", file=sys.stderr)
            return result

    except Exception as e:
        print(f"[{time.time()}] [ERROR] Error in getClassInfo: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return None
    # Replace your finally block with this:

    finally:
        # Clean up browser context
        if browser_context:
            try:
                # Check if the context is still open before trying to close it
                if not browser_context.is_closed():
                    await browser_context.close()
                    print(f"[{time.time()}] [CLEANUP] Playwright browser context closed successfully", file=sys.stderr)
                else:
                    print(f"[{time.time()}] [CLEANUP] Browser context was already closed", file=sys.stderr)
            except Exception as close_error:
                print(f"[{time.time()}] [CLEANUP_WARNING] Error closing browser context: {close_error}", file=sys.stderr)
                # Continue with cleanup anyway
        
        # Clean up temporary user data directory
        if user_data_dir and os.path.exists(user_data_dir):
            try:
                shutil.rmtree(user_data_dir)
                print(f"[{time.time()}] [CLEANUP] Temp directory cleaned: {user_data_dir}", file=sys.stderr)
            except Exception as cleanup_error:
                print(f"[{time.time()}] [CLEANUP_WARNING] Error cleaning temp dir: {cleanup_error}", file=sys.stderr)
        
        print(f"[{time.time()}] [MEMORY_TRACK] After cleanup: {get_memory_usage()}", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Class number required"}))
        sys.exit(1)
        
    input_class_number = sys.argv[1]
    
    # Run the async Playwright function
    class_info = asyncio.run(getClassInfo(input_class_number))
    
    if class_info:
        print(json.dumps(class_info))
    else:
        print(json.dumps({"error": "Class not found"}))
        
    sys.stdout.flush()